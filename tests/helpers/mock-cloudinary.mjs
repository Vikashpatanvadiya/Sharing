/**
 * A stand-in for the Cloudinary API, good enough to drive the real upload,
 * verify, duplicate and destroy paths of the app under test.
 *
 * It validates upload signatures exactly the way Cloudinary does (sorted
 * params + API secret, SHA-1), so a signing regression fails the tests rather
 * than sailing through a permissive fake. It speaks TLS because the Cloudinary
 * SDK picks http vs https at module load and always chooses https for its
 * API calls.
 */
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const assets = new Map(); // public_id -> asset record

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Pulls the fields we care about out of a multipart upload body. */
function parseMultipart(buffer, contentType) {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (!boundary) return { fields: {}, file: Buffer.alloc(0) };
  const sep = Buffer.from(`--${boundary}`);
  const fields = {};
  let file = Buffer.alloc(0);
  let offset = 0;
  while (true) {
    const start = buffer.indexOf(sep, offset);
    if (start === -1) break;
    const next = buffer.indexOf(sep, start + sep.length);
    if (next === -1) break;
    const part = buffer.subarray(start + sep.length, next);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      offset = next;
      continue;
    }
    const headers = part.subarray(0, headerEnd).toString();
    const content = part.subarray(headerEnd + 4, part.length - 2);
    const name = /name="([^"]+)"/.exec(headers)?.[1];
    if (name === "file") file = content;
    else if (name) fields[name] = content.toString();
    offset = next;
  }
  return { fields, file };
}

export function startMockCloudinary(cloudName, apiSecret, certDir) {
  // TLS, because the Cloudinary SDK decides between http and https at module
  // load time and always picks https for its API calls.
  const tls = {
    key: fs.readFileSync(path.join(certDir, "key.pem")),
    cert: fs.readFileSync(path.join(certDir, "cert.pem")),
  };
  const server = https.createServer(tls, async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    // /v1_1/<cloud>/...
    const rest = parts.slice(2);

    // Direct upload: POST /v1_1/<cloud>/<resource_type>/upload
    if (req.method === "POST" && rest.length === 2 && rest[1] === "upload") {
      const resourceType = rest[0];
      const { fields, file } = parseMultipart(await readBody(req), req.headers["content-type"] ?? "");

      // Verify the signature exactly the way Cloudinary does.
      const signable = Object.keys(fields)
        .filter((k) => !["file", "api_key", "resource_type", "cloud_name", "signature"].includes(k))
        .sort()
        .map((k) => `${k}=${fields[k]}`)
        .join("&");
      const expected = crypto.createHash("sha1").update(signable + apiSecret).digest("hex");
      if (fields.signature !== expected) {
        return json(res, 401, { error: { message: "Invalid Signature" } });
      }
      if (assets.has(fields.public_id) && fields.overwrite !== "true") {
        return json(res, 400, { error: { message: "Asset already exists" } });
      }

      const asset = {
        public_id: fields.public_id,
        resource_type: resourceType,
        type: "upload",
        secure_url: `https://127.0.0.1:${server.address().port}/raw/${encodeURIComponent(fields.public_id)}`,
        bytes: file.length,
        format: resourceType === "video" ? "mov" : "jpg",
        width: resourceType === "video" ? 1920 : 4032,
        height: resourceType === "video" ? 1080 : 3024,
        ...(resourceType === "video" ? { duration: 12.5 } : {}),
        asset_id: crypto.randomUUID().replace(/-/g, ""),
        version: Math.floor(Date.now() / 1000),
        // Cloudinary's etag is a content hash, which is what powers duplicate
        // detection in the app.
        etag: crypto.createHash("md5").update(file).digest("hex").slice(0, 16),
        _bytes: file,
      };
      assets.set(asset.public_id, asset);
      return json(res, 200, { ...asset, _bytes: undefined });
    }

    // Serving the stored original back.
    if (req.method === "GET" && parts[0] === "raw") {
      const asset = assets.get(decodeURIComponent(parts.slice(1).join("/")));
      if (!asset) return json(res, 404, { error: { message: "not found" } });
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": asset._bytes.length,
      });
      return res.end(asset._bytes);
    }

    // Admin API: GET /v1_1/<cloud>/resources/<type>/upload/<public_id...>
    if (req.method === "GET" && rest[0] === "resources") {
      // The SDK sends the public_id as one URL-encoded segment.
      const publicId = decodeURIComponent(rest.slice(3).join("/"));
      const asset = assets.get(publicId);
      if (!asset) return json(res, 404, { error: { message: "Resource not found" } });
      return json(res, 200, { ...asset, _bytes: undefined });
    }

    // Destroy: POST /v1_1/<cloud>/<resource_type>/destroy
    if (req.method === "POST" && rest[1] === "destroy") {
      const body = await readBody(req);
      const contentType = req.headers["content-type"] ?? "";
      const publicId = contentType.includes("multipart/form-data")
        ? parseMultipart(body, contentType).fields.public_id
        : new URLSearchParams(body.toString()).get("public_id");
      const existed = assets.delete(publicId);
      return json(res, 200, { result: existed ? "ok" : "not found" });
    }

    // Bulk delete: DELETE /v1_1/<cloud>/resources/<resource_type>/upload
    if (req.method === "DELETE" && rest[0] === "resources") {
      const body = (await readBody(req)).toString();
      const params = new URLSearchParams(body || url.search.replace(/^\?/, ""));
      const ids = [...params.getAll("public_ids[]"), ...params.getAll("public_ids")];
      const deleted = {};
      for (const id of ids) deleted[id] = assets.delete(id) ? "deleted" : "not_found";
      return json(res, 200, { deleted });
    }

    // Folder cleanup is a genuine no-op; anything else is a mock gap and must
    // fail loudly rather than fake a success.
    if (rest[0] === "folders") return json(res, 200, { result: "ok" });
    console.log("[mock] UNHANDLED", req.method, url.pathname, url.search);
    return json(res, 500, { error: { message: "unhandled in mock" } });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port, assets }),
    );
  });
}
