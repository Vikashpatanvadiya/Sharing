import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { awaitJob } from "../helpers/harness.mjs";

/**
 * Scenarios 8, 9 and 10: the paths where real bytes move.
 *
 * A tiny local HTTP server stands in for the Cloudinary CDN, so downloads and
 * ZIP building run end to end against genuine file content and the results can
 * be byte-compared against the source.
 */
export const name = "Signatures, originals and ZIP fidelity";

export async function run({ call, rawCall, sql, check, section, createJar, tmpDir, apiSecret, albumsSeen }) {
  /* ------------------------------------------------------------------ */
  /* 1. Cloudinary signature: verify against the algorithm Cloudinary uses */
  /* ------------------------------------------------------------------ */
  section("Cloudinary upload signature");
  const jar = createJar();
  const createRes = await rawCall(jar, "POST", "/api/albums", { name: "Signature Check" });
  const { album } = await createRes.json();
  albumsSeen.push(album.id);

  const ticketRes = await rawCall(jar, "POST", `/api/albums/${album.id}/upload/signature`, {
    files: [{ clientId: "a", filename: "IMG_9.jpg", mimeType: "image/jpeg", fileSize: 1024 }],
  });
  const ticket = (await ticketRes.json()).tickets[0];

  // Cloudinary signs the alphabetically sorted, &-joined params (excluding file,
  // api_key, resource_type and cloud_name) with the API secret appended.
  const signedParams = {
    invalidate: "false",
    overwrite: "false",
    public_id: ticket.publicId,
    timestamp: String(ticket.timestamp),
  };
  const toSign = Object.keys(signedParams)
    .sort()
    .map((k) => `${k}=${signedParams[k]}`)
    .join("&");
  const expected = crypto
    .createHash("sha1")
    .update(toSign + apiSecret)
    .digest("hex");

  check("signature matches Cloudinary's algorithm", ticket.signature === expected, `${ticket.signature} != ${expected}`);
  check("upload URL targets the right cloud + resource type",
    ticket.uploadUrl === "https://api.cloudinary.com/v1_1/test-cloud/image/upload", ticket.uploadUrl);
  check("each file gets a distinct public_id", true);

  const secondTicket = (
    await (
      await rawCall(jar, "POST", `/api/albums/${album.id}/upload/signature`, {
        files: [{ clientId: "b", filename: "IMG_9.jpg", mimeType: "image/jpeg", fileSize: 1024 }],
      })
    ).json()
  ).tickets[0];
  check("public_ids are unique per upload (no overwrite possible)",
    secondTicket.publicId !== ticket.publicId, "");

  /* ------------------------------------------------------------------ */
  /* 2. Downloads with real bytes                                        */
  /* ------------------------------------------------------------------ */
  section("Original downloads and ZIP packaging");

  // Three "originals" with distinctive, incompressible content.
  const originals = {
    "IMG_001.JPG": crypto.randomBytes(400_000),
    "IMG_002.HEIC": crypto.randomBytes(650_000),
    "VID_001.MOV": crypto.randomBytes(1_200_000),
  };

  const origin = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const name = decodeURIComponent(req.url.slice(1));
      const body = originals[name];
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      // Honour Range so the proxy's video-seek path is exercised too.
      const range = req.headers.range;
      if (range) {
        const [start, end] = range.replace("bytes=", "").split("-");
        const from = Number(start);
        const to = end ? Number(end) : body.length - 1;
        res.writeHead(206, {
          "Content-Type": "application/octet-stream",
          "Content-Range": `bytes ${from}-${to}/${body.length}`,
          "Content-Length": to - from + 1,
          "Accept-Ranges": "bytes",
        });
        res.end(body.subarray(from, to + 1));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": body.length });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
  const originPort = origin.address().port;

  const [contributor] = await sql`select * from contributors where album_id = ${album.id} limit 1`;
  const ids = {};
  for (const [filename, bytes] of Object.entries(originals)) {
    const [row] = await sql`
      insert into media (album_id, contributor_id, uploader_name, cloudinary_public_id,
        cloudinary_resource_type, cloudinary_secure_url, original_filename, format, mime_type, file_size)
      values (${album.id}, ${contributor.id}, ${"Vikash"},
        ${`shared-albums/album_${album.id}/${filename}`},
        ${filename.endsWith(".MOV") ? "video" : "image"},
        ${`http://127.0.0.1:${originPort}/${encodeURIComponent(filename)}`},
        ${filename}, ${filename.split(".").pop().toLowerCase()},
        ${filename.endsWith(".MOV") ? "video/quicktime" : "image/jpeg"}, ${bytes.length})
      returning *`;
    ids[filename] = row.id;
  }

  // -- Scenario 8: download one original ------------------------------------
  const single = await rawCall(jar, "GET", `/api/media/${ids["IMG_001.JPG"]}/download`);
  const singleBytes = Buffer.from(await single.arrayBuffer());
  check("single download returns 200", single.status === 200, `got ${single.status}`);
  check("bytes are byte-for-byte the original",
    singleBytes.equals(originals["IMG_001.JPG"]), `${singleBytes.length} vs ${originals["IMG_001.JPG"].length}`);
  check("original filename preserved in Content-Disposition",
    (single.headers.get("content-disposition") ?? "").includes('filename="IMG_001.JPG"'),
    single.headers.get("content-disposition"));
  check("served as an attachment",
    (single.headers.get("content-disposition") ?? "").startsWith("attachment"), "");
  check("private cache headers", (single.headers.get("cache-control") ?? "").includes("no-store"), "");

  const heic = await rawCall(jar, "GET", `/api/media/${ids["IMG_002.HEIC"]}/download`);
  const heicBytes = Buffer.from(await heic.arrayBuffer());
  check("HEIC comes back as HEIC, not converted",
    heicBytes.equals(originals["IMG_002.HEIC"]) &&
      (heic.headers.get("content-disposition") ?? "").includes(".HEIC"), "");

  // -- Range request (video seeking) ----------------------------------------
  const ranged = await rawCall(jar, "GET", `/api/media/${ids["VID_001.MOV"]}/original`, undefined, {
    Range: "bytes=100-199",
  });
  const rangedBytes = Buffer.from(await ranged.arrayBuffer());
  check("range request returns 206", ranged.status === 206, `got ${ranged.status}`);
  check("range bytes match the original slice",
    rangedBytes.equals(originals["VID_001.MOV"].subarray(100, 200)), `len=${rangedBytes.length}`);

  // -- Scenario 9/10: ZIP of selected + whole album --------------------------
  async function runJob(mediaIds) {
    const res = await rawCall(jar, "POST", `/api/albums/${album.id}/downloads`, mediaIds ? { mediaIds } : {});
    return awaitJob(call, jar, (await res.json()).job.id);
  }

  const selectedJob = await runJob([ids["IMG_001.JPG"], ids["IMG_002.HEIC"]]);
  check("selected-files ZIP became ready", selectedJob?.status === "ready", JSON.stringify(selectedJob));
  check("no partial-file warning", !selectedJob?.error, selectedJob?.error ?? "");

  const zipRes = await rawCall(jar, "GET", selectedJob.downloadUrl);
  const zipBytes = Buffer.from(await zipRes.arrayBuffer());
  const zipPath = path.join(tmpDir, "selected.zip");
  fs.writeFileSync(zipPath, zipBytes);
  check("ZIP downloads with the album's name",
    (zipRes.headers.get("content-disposition") ?? "").includes("Signature-Check.zip"),
    zipRes.headers.get("content-disposition"));

  const listing = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
  check("ZIP contains both selected originals",
    listing.includes("IMG_001.JPG") && listing.includes("IMG_002.HEIC"), listing);
  check("ZIP excludes what wasn't selected", !listing.includes("VID_001.MOV"), listing);

  const extractDir = path.join(tmpDir, "extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  execFileSync("unzip", ["-qq", "-o", zipPath, "-d", extractDir]);
  check("extracted JPG is byte-identical to the upload",
    fs.readFileSync(path.join(extractDir, "IMG_001.JPG")).equals(originals["IMG_001.JPG"]), "");
  check("extracted HEIC is byte-identical (no re-encoding)",
    fs.readFileSync(path.join(extractDir, "IMG_002.HEIC")).equals(originals["IMG_002.HEIC"]), "");

  const stored = execFileSync("unzip", ["-v", zipPath], { encoding: "utf8" });
  check("entries are stored, not re-compressed", /Stored/.test(stored), stored);

  const albumJob = await runJob();
  check("whole-album ZIP became ready", albumJob?.status === "ready", JSON.stringify(albumJob));
  check("album ZIP includes every file", albumJob?.fileCount === 3, `${albumJob?.fileCount}`);
  const albumZipPath = path.join(tmpDir, "album.zip");
  fs.writeFileSync(albumZipPath, Buffer.from(await (await rawCall(jar, "GET", albumJob.downloadUrl)).arrayBuffer()));
  const albumListing = execFileSync("unzip", ["-l", albumZipPath], { encoding: "utf8" });
  check("album ZIP has photos and the video",
    ["IMG_001.JPG", "IMG_002.HEIC", "VID_001.MOV"].every((n) => albumListing.includes(n)), albumListing);
  const extractedVideo = execFileSync("unzip", ["-p", albumZipPath, "VID_001.MOV"], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: "buffer",
  });
  check("video inside the ZIP is the untouched original",
    Buffer.from(extractedVideo).equals(originals["VID_001.MOV"]), `${extractedVideo.length}`);

  /* ------------------------------------------------------------------ */
  /* 3. Duplicate-name handling inside a ZIP                             */
  /* ------------------------------------------------------------------ */
  const [dupRow] = await sql`
    insert into media (album_id, contributor_id, uploader_name, cloudinary_public_id,
      cloudinary_resource_type, cloudinary_secure_url, original_filename, format, mime_type, file_size)
    values (${album.id}, ${contributor.id}, ${"Rahul"},
      ${`shared-albums/album_${album.id}/dup`}, ${"image"},
      ${`http://127.0.0.1:${originPort}/IMG_001.JPG`}, ${"IMG_001.JPG"}, ${"jpg"}, ${"image/jpeg"},
      ${originals["IMG_001.JPG"].length})
    returning *`;
  const dupJob = await runJob([ids["IMG_001.JPG"], dupRow.id]);
  const dupZipPath = path.join(tmpDir, "dup.zip");
  fs.writeFileSync(dupZipPath, Buffer.from(await (await rawCall(jar, "GET", dupJob.downloadUrl)).arrayBuffer()));
  const dupListing = execFileSync("unzip", ["-l", dupZipPath], { encoding: "utf8" });
  check("same filename from two people is de-duplicated in the ZIP",
    dupListing.includes("IMG_001.JPG") && dupListing.includes("IMG_001 (2).JPG"), dupListing);

  origin.close();
}
