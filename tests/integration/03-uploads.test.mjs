import crypto from "node:crypto";

/**
 * Scenarios 4, 5, 7, 34 and 35: the complete upload -> verify -> gallery ->
 * delete loop, driven against a mock Cloudinary that checks signatures the way
 * the real service does.
 *
 * `uploadToCloudinary` below is the exact request the browser upload queue
 * makes, so a change to the signed parameter set fails here.
 */
export const name = "Uploads, duplicates and storage deletion";

export async function run({ call, sql, check, section, createJar, mock, albumsSeen }) {
  /** Exactly what the browser upload queue sends, in Node. */
  async function uploadToCloudinary(ticket, filename, bytes, mimeType) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mimeType }), filename);
    form.append("api_key", ticket.apiKey);
    form.append("timestamp", String(ticket.timestamp));
    form.append("signature", ticket.signature);
    form.append("public_id", ticket.publicId);
    form.append("overwrite", "false");
    form.append("invalidate", "false");
    const res = await fetch(ticket.uploadUrl, { method: "POST", body: form });
    return { status: res.status, body: await res.json() };
  }

  const vikash = createJar("vikash");
  const rahul = createJar("rahul");

  const created = await call(vikash, "POST", "/api/albums", {
    name: "Wedding 2026",
    creatorName: "Vikash",
  });
  const albumId = created.json.album.id;
  albumsSeen.push(albumId);
  await call(rahul, "POST", "/api/albums/join", {
    code: created.json.joinCode,
    displayName: "Rahul",
  });

  /** The whole client-side upload sequence for one file. */
  async function fullUpload(jar, filename, bytes, mimeType, allowDuplicate) {
    const ticketRes = await call(jar, "POST", `/api/albums/${albumId}/upload/signature`, {
      files: [{ clientId: "x", filename, mimeType, fileSize: bytes.length }],
    });
    if (ticketRes.status !== 200) return { stage: "signature", ...ticketRes };
    const ticket = ticketRes.json.tickets[0];
    const upload = await uploadToCloudinary(ticket, filename, bytes, mimeType);
    if (upload.status !== 200) return { stage: "cloudinary", ...upload };
    const register = await call(jar, "POST", `/api/albums/${albumId}/media`, {
      publicId: upload.body.public_id,
      resourceType: upload.body.resource_type,
      originalFilename: filename,
      mimeType,
      ...(allowDuplicate ? { allowDuplicate: true } : {}),
    });
    return { stage: "registered", ticket, upload, ...register };
  }

  section("Scenario 4 — Upload a photo end to end");
  const photoBytes = crypto.randomBytes(8_400_000);
  const photo = await fullUpload(vikash, "IMG_1234.JPG", photoBytes, "image/jpeg");
  check("registered (201)", photo.status === 201, `${photo.stage} ${photo.status} ${photo.text?.slice(0, 200)}`);
  check("Cloudinary holds the original", mock.assets.has(photo.ticket.publicId), "");
  check("stored bytes are unmodified",
    mock.assets.get(photo.ticket.publicId)?._bytes.equals(photoBytes), "");
  check("size recorded from Cloudinary, not the client", photo.json?.media?.fileSize === photoBytes.length, `${photo.json?.media?.fileSize}`);
  check("dimensions captured", photo.json?.media?.width === 4032 && photo.json?.media?.height === 3024, "");
  check("uploader is the session identity", photo.json?.media?.uploaderName === "Vikash", photo.json?.media?.uploaderName);
  check("filename preserved exactly", photo.json?.media?.originalFilename === "IMG_1234.JPG", "");

  const [dbRow] = await sql`select * from media where id = ${photo.json.media.id}`;
  check("database record exists", Boolean(dbRow), "");
  check("public_id stored for later deletion", dbRow?.cloudinary_public_id === photo.ticket.publicId, "");
  check("resource type stored", dbRow?.cloudinary_resource_type === "image", "");
  check("asset id stored", Boolean(dbRow?.cloudinary_asset_id), "");
  check("checksum stored for duplicate detection", Boolean(dbRow?.checksum), "");

  section("Scenario 6 (video) — Upload a video end to end");
  const videoBytes = crypto.randomBytes(3_000_000);
  const video = await fullUpload(rahul, "VID_0007.MOV", videoBytes, "video/quicktime");
  check("video registered", video.status === 201, `${video.stage} ${video.status} ${video.text?.slice(0, 200)}`);
  check("stored as a video resource", video.json?.media?.resourceType === "video", "");
  check("duration captured", video.json?.media?.duration === 12.5, `${video.json?.media?.duration}`);
  check("MOV not transcoded on ingest",
    mock.assets.get(video.ticket.publicId)?._bytes.equals(videoBytes), "");

  section("Scenario 35 — Duplicate detection");
  const dup = await fullUpload(rahul, "IMG_1234_copy.JPG", photoBytes, "image/jpeg");
  check("duplicate reported as 409", dup.status === 409, `${dup.status} ${dup.text?.slice(0, 160)}`);
  check("names the existing file", dup.json?.error?.details?.existing?.originalFilename === "IMG_1234.JPG", "");
  check("existing original untouched", mock.assets.has(photo.ticket.publicId), "");

  const pendingId = dup.json.error.details.pendingPublicId;
  const discard = await call(rahul, "POST", `/api/albums/${albumId}/media/discard`, {
    publicId: pendingId, resourceType: "image",
  });
  check("cancelling removes only the new copy", discard.status === 200 && !mock.assets.has(pendingId), "");
  check("the original is still there after cancelling", mock.assets.has(photo.ticket.publicId), "");

  const dup2 = await fullUpload(rahul, "IMG_1234_copy.JPG", photoBytes, "image/jpeg", true);
  check("'upload anyway' succeeds", dup2.status === 201, `${dup2.status}`);

  section("Forged registration attempts");
  const forged = await call(rahul, "POST", `/api/albums/${albumId}/media`, {
    publicId: "shared-albums/album_00000000-0000-0000-0000-000000000000/evil",
    resourceType: "image",
    originalFilename: "evil.jpg",
  });
  check("cannot register an asset from another album's folder (403)", forged.status === 403, `got ${forged.status}`);
  const ghost = await call(rahul, "POST", `/api/albums/${albumId}/media`, {
    publicId: `shared-albums/album_${albumId}/does-not-exist`,
    resourceType: "image",
    originalFilename: "ghost.jpg",
  });
  check("cannot register an asset that was never uploaded (502)", ghost.status === 502, `got ${ghost.status}`);

  section("Scenario 5 — A contributor deletes their own media");
  const beforeDelete = mock.assets.size;
  const delOwn = await call(rahul, "DELETE", `/api/media/${video.json.media.id}`);
  check("delete succeeds (200)", delOwn.status === 200, `${delOwn.status} ${delOwn.text?.slice(0, 160)}`);
  check("Cloudinary asset destroyed", !mock.assets.has(video.ticket.publicId), "");
  check("exactly one asset removed", mock.assets.size === beforeDelete - 1, "");
  const gone = await sql`select count(*)::int as n from media where id = ${video.json.media.id}`;
  check("database record deleted", gone[0].n === 0, "");
  const gallery = await call(rahul, "GET", `/api/albums/${albumId}/media`);
  check("disappears from the gallery",
    !(gallery.json?.items ?? []).some((i) => i.id === video.json.media.id), "");

  section("Scenario 7 — Admin deletes someone else's media");
  const rahulsRemaining = (await call(rahul, "GET", `/api/albums/${albumId}/media`)).json.items
    .find((i) => i.uploaderName === "Rahul");
  const adminDelete = await call(vikash, "DELETE", `/api/media/${rahulsRemaining.id}`);
  check("admin delete succeeds", adminDelete.status === 200, `${adminDelete.status}`);
  const [adminDeletedRow] = await sql`select * from media where id = ${rahulsRemaining.id}`;
  check("database record deleted", !adminDeletedRow, "");

  section("Scenario 34 — Album deletion clears storage");
  const before = mock.assets.size;
  check("assets still present before deletion", before > 0, `${before}`);
  const albumDelete = await call(vikash, "DELETE", `/api/albums/${albumId}`, { confirmName: "Wedding 2026" });
  check("album deleted", albumDelete.status === 200, `${albumDelete.status} ${albumDelete.text?.slice(0, 160)}`);
  check("no orphaned Cloudinary assets left", mock.assets.size === 0, `${mock.assets.size} remaining`);
  check("no cleanup warning when storage cooperated", albumDelete.json?.warning === null, albumDelete.json?.warning);
  const orphanRows = await sql`select count(*)::int as n from orphaned_assets where album_id = ${albumId}`;
  check("nothing flagged as orphaned", orphanRows[0].n === 0, "");

  section("Rate limiting on album-code attempts");
  const attacker = createJar();
  let blockedAt = null;
  for (let i = 0; i < 25; i += 1) {
    const res = await call(attacker, "POST", "/api/albums/join", { code: `AAA${String(i).padStart(3, "0")}` });
    if (res.status === 429) { blockedAt = i + 1; break; }
  }
  check("brute-force attempts get rate limited", blockedAt !== null && blockedAt <= 20, `blocked after ${blockedAt}`);
}
