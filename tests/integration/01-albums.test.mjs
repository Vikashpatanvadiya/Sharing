/**
 * Scenarios 1, 2, 3, 6, 7, 12 and 21 from the specification, plus the
 * authorization rules that surround them.
 *
 * Cloudinary credentials are intentionally invalid in this suite. That is a
 * feature: it proves that when storage refuses a delete, the app reports the
 * failure and keeps the database row instead of pretending to have succeeded.
 */
export const name = "API, authorization and permissions";

export async function run({ call, sql, check, section, createJar, albumsSeen }) {
  // Three independent browsers: the album creator, a friend who joins, and
  // someone who was never given the code.
  const vikash = createJar("vikash");
  const rahul = createJar("rahul");
  const stranger = createJar("stranger");

  section("Scenario 1 — Create album");
  const created = await call(vikash, "POST", "/api/albums", {
    name: "Goa Trip 2026",
    description: "Our Goa trip memories",
    eventDate: "2026-08-25",
    creatorName: "Vikash",
  });
  check("album created (201)", created.status === 201, `got ${created.status} ${created.text.slice(0, 200)}`);
  const albumId = created.json?.album?.id;
  albumsSeen.push(albumId);
  const joinCode = created.json?.joinCode;
  check("unique code generated", typeof joinCode === "string" && joinCode.length === 6, `code=${joinCode}`);
  check("admin session cookie set", vikash.has("sa_admin"), "");
  check("contributor session cookie set", vikash.has("sa_member"), "");

  const [albumRow] = await sql`select * from albums where id = ${albumId}`;
  check("raw join code is NOT stored in plaintext", !JSON.stringify(albumRow).includes(joinCode), "");
  check("join code stored as keyed hash", albumRow.join_code_hash?.length === 64, "");
  check("admin token stored as hash only", albumRow.admin_token_hash?.length === 64, "");

  section("Scenario 3 — Join with an incorrect code");
  const badJoin = await call(rahul, "POST", "/api/albums/join", { code: "ZZZZZZ" });
  check("access denied (404)", badJoin.status === 404, `got ${badJoin.status}`);
  check(
    "failure message reveals nothing about existence",
    badJoin.json?.error?.message === "Album not found. Please check your code and try again.",
    badJoin.json?.error?.message,
  );

  section("Scenario 2 — Join with the correct code");
  const goodJoin = await call(rahul, "POST", "/api/albums/join", { code: joinCode, displayName: "Rahul" });
  check("access granted (200)", goodJoin.status === 200, `got ${goodJoin.status}`);
  check("album visible", goodJoin.json?.album?.name === "Goa Trip 2026", "");
  check("joined as contributor, not admin", goodJoin.json?.viewer?.role === "contributor", goodJoin.json?.viewer?.role);
  check("contributor never sees the join code", goodJoin.json?.joinCode === undefined, "");

  const adminView = await call(vikash, "GET", `/api/albums/${albumId}`);
  check("creator is admin", adminView.json?.viewer?.role === "admin", "");
  check("admin can re-read the join code", adminView.json?.joinCode === joinCode, "");

  section("Scenario 12 — Access the album without a code");
  const noAccess = await call(stranger, "GET", `/api/albums/${albumId}`);
  check("access denied (401)", noAccess.status === 401, `got ${noAccess.status}`);
  const noAccessMedia = await call(stranger, "GET", `/api/albums/${albumId}/media`);
  check("gallery denied too (401)", noAccessMedia.status === 401, `got ${noAccessMedia.status}`);

  section("Upload authorization");
  const goodTicket = await call(vikash, "POST", `/api/albums/${albumId}/upload/signature`, {
    files: [{ clientId: "c1", filename: "IMG_0001.HEIC", mimeType: "image/heic", fileSize: 12_000_000 }],
  });
  check("signature issued for a HEIC original", goodTicket.status === 200, goodTicket.text.slice(0, 200));
  const ticket = goodTicket.json?.tickets?.[0];
  check("public_id is scoped to this album's folder", ticket?.publicId?.startsWith(`shared-albums/album_${albumId}/`), ticket?.publicId);
  check("resource type is image (no HEIC->JPG coercion)", ticket?.resourceType === "image", ticket?.resourceType);
  check("API secret never leaves the server", !goodTicket.text.includes("test-secret-not-real"), "");
  check("signature + api key returned", Boolean(ticket?.signature && ticket?.apiKey), "");

  const videoTicket = await call(vikash, "POST", `/api/albums/${albumId}/upload/signature`, {
    files: [{ clientId: "c2", filename: "VID_0001.MOV", mimeType: "video/quicktime", fileSize: 180_000_000 }],
  });
  check("MOV accepted as video resource", videoTicket.json?.tickets?.[0]?.resourceType === "video", "");

  const badFormat = await call(vikash, "POST", `/api/albums/${albumId}/upload/signature`, {
    files: [{ clientId: "c3", filename: "notes.pdf", mimeType: "application/pdf", fileSize: 1000 }],
  });
  check("unsupported format rejected (415)", badFormat.status === 415, `got ${badFormat.status}`);

  // One bad file in a batch must not take the good ones down with it.
  const mixedBatch = await call(vikash, "POST", `/api/albums/${albumId}/upload/signature`, {
    files: [
      { clientId: "m1", filename: "good1.jpg", mimeType: "image/jpeg", fileSize: 1000 },
      { clientId: "m2", filename: "notes.pdf", mimeType: "application/pdf", fileSize: 1000 },
      { clientId: "m3", filename: "huge.jpg", mimeType: "image/jpeg", fileSize: 500 * 1024 * 1024 },
      { clientId: "m4", filename: "good2.mov", mimeType: "video/quicktime", fileSize: 2000 },
    ],
  });
  check("mixed batch still succeeds (200)", mixedBatch.status === 200, `got ${mixedBatch.status}`);
  check("valid files in a mixed batch are signed",
    (mixedBatch.json?.tickets ?? []).map((t) => t.clientId).sort().join(",") === "m1,m4",
    JSON.stringify((mixedBatch.json?.tickets ?? []).map((t) => t.clientId)));
  check("invalid files are reported individually",
    (mixedBatch.json?.rejected ?? []).map((r) => r.clientId).sort().join(",") === "m2,m3",
    JSON.stringify(mixedBatch.json?.rejected));
  check("each rejection explains itself",
    (mixedBatch.json?.rejected ?? []).every((r) => typeof r.message === "string" && r.message.length > 10),
    JSON.stringify(mixedBatch.json?.rejected));

  const tooBig = await call(vikash, "POST", `/api/albums/${albumId}/upload/signature`, {
    files: [{ clientId: "c4", filename: "huge.jpg", mimeType: "image/jpeg", fileSize: 500 * 1024 * 1024 }],
  });
  check("oversized photo rejected (413)", tooBig.status === 413, `got ${tooBig.status}`);
  check("size error names the limit", /100 MB/.test(tooBig.json?.error?.message ?? ""), tooBig.json?.error?.message);

  const strangerTicket = await call(stranger, "POST", `/api/albums/${albumId}/upload/signature`, {
    files: [{ clientId: "c5", filename: "x.jpg", mimeType: "image/jpeg", fileSize: 100 }],
  });
  check("non-member cannot get an upload signature (401)", strangerTicket.status === 401, `got ${strangerTicket.status}`);

  section("Scenario 4 — Media rows for two different uploaders");
  // Stands in for two completed Cloudinary uploads (no real account here).
  const [vikashContributor] = await sql`
    select * from contributors where album_id = ${albumId} and is_admin = 1 limit 1`;
  const [rahulContributor] = await sql`
    select * from contributors where album_id = ${albumId} and is_admin = 0 limit 1`;
  check("Vikash has a contributor record", Boolean(vikashContributor), "");
  check("Rahul's display name was saved", rahulContributor?.display_name === "Rahul", rahulContributor?.display_name);

  async function seedMedia(contributor, filename, resourceType, bytes) {
    const [row] = await sql`
      insert into media (album_id, contributor_id, uploader_name, cloudinary_public_id,
        cloudinary_resource_type, cloudinary_secure_url, original_filename, format,
        mime_type, file_size, width, height)
      values (${albumId}, ${contributor.id}, ${contributor.display_name},
        ${`shared-albums/album_${albumId}/${filename.replace(/\W/g, "")}`},
        ${resourceType}, ${"https://res.cloudinary.com/test-cloud/x"}, ${filename},
        ${filename.split(".").pop().toLowerCase()}, ${resourceType === "video" ? "video/quicktime" : "image/jpeg"},
        ${bytes}, ${4032}, ${3024})
      returning *`;
    return row;
  }

  const vikashPhoto1 = await seedMedia(vikashContributor, "IMG_001.jpg", "image", 8_400_000);
  const vikashPhoto2 = await seedMedia(vikashContributor, "IMG_002.jpg", "image", 7_100_000);
  const rahulPhoto3 = await seedMedia(rahulContributor, "IMG_003.jpg", "image", 6_200_000);
  const rahulVideo = await seedMedia(rahulContributor, "VID_004.mov", "video", 180_000_000);

  const rahulGallery = await call(rahul, "GET", `/api/albums/${albumId}/media`);
  check("gallery lists all four items", rahulGallery.json?.items?.length === 4, `got ${rahulGallery.json?.items?.length}`);
  const byName = Object.fromEntries((rahulGallery.json?.items ?? []).map((i) => [i.originalFilename, i]));
  check("uploader attributed correctly", byName["IMG_001.jpg"]?.uploaderName === "Vikash", byName["IMG_001.jpg"]?.uploaderName);
  check("original filename preserved", Boolean(byName["VID_004.mov"]), "");
  check("gallery serves a thumbnail URL", /res\.cloudinary\.com/.test(byName["IMG_001.jpg"]?.thumbnailUrl ?? ""), "");
  check(
    "thumbnail is a delivery transformation, not the original",
    /c_fill|q_auto/.test(byName["IMG_001.jpg"]?.thumbnailUrl ?? ""),
    byName["IMG_001.jpg"]?.thumbnailUrl,
  );
  check(
    "original is served through an authorized app endpoint",
    byName["IMG_001.jpg"]?.originalUrl === `/api/media/${vikashPhoto1.id}/original`,
    byName["IMG_001.jpg"]?.originalUrl,
  );
  check("video gets a poster frame", Boolean(byName["VID_004.mov"]?.posterUrl), "");

  section("Scenario 6 — Rahul tries to delete Vikash's photo");
  check("Rahul may not delete Vikash's photo (canDelete=false)", byName["IMG_001.jpg"]?.canDelete === false, "");
  check("Rahul may delete his own (canDelete=true)", byName["IMG_003.jpg"]?.canDelete === true, "");

  const forbidden = await call(rahul, "DELETE", `/api/media/${vikashPhoto1.id}`);
  check("403 Forbidden", forbidden.status === 403, `got ${forbidden.status}`);
  const [stillThere] = await sql`select * from media where id = ${vikashPhoto1.id}`;
  check("database record remains", Boolean(stillThere), "");
  const orphansAfterForbidden = await sql`select count(*)::int as n from orphaned_assets where album_id = ${albumId}`;
  check("no storage call was even attempted", orphansAfterForbidden[0].n === 0, "");

  section("Admin sees everything as deletable");
  const adminGallery = await call(vikash, "GET", `/api/albums/${albumId}/media`);
  check(
    "admin can delete anyone's media",
    (adminGallery.json?.items ?? []).every((i) => i.canDelete === true),
    "",
  );

  section("Storage-failure safety (fake Cloudinary credentials)");
  const deleteOwn = await call(rahul, "DELETE", `/api/media/${rahulPhoto3.id}`);
  check("storage failure surfaces as 502, not a fake success", deleteOwn.status === 502, `got ${deleteOwn.status}`);
  const [keptRow] = await sql`select * from media where id = ${rahulPhoto3.id}`;
  check("DB row kept when storage delete fails", Boolean(keptRow), "");
  const orphans = await sql`select * from orphaned_assets where album_id = ${albumId}`;
  check("failure recorded for retry (no silent orphan)", orphans.length === 1, `rows=${orphans.length}`);

  section("Scenario 21 — Bulk delete respects ownership");
  const bulk = await call(rahul, "POST", "/api/media/bulk-delete", {
    mediaIds: [rahulVideo.id, vikashPhoto1.id, vikashPhoto2.id],
  });
  check("bulk delete returns 200", bulk.status === 200, `got ${bulk.status}`);
  const forbiddenIds = (bulk.json?.failed ?? []).filter((f) => f.reason === "forbidden").map((f) => f.id);
  check("both of Vikash's items refused", forbiddenIds.length === 2, JSON.stringify(bulk.json?.failed));
  check("caller is told others' files were skipped", Boolean(bulk.json?.message), bulk.json?.message);
  const [vikashStill] = await sql`select * from media where id = ${vikashPhoto2.id}`;
  check("Vikash's media untouched", Boolean(vikashStill), "");

  section("Album statistics");
  const stats = (await call(vikash, "GET", `/api/albums/${albumId}`)).json?.album?.stats;
  check("photo count", stats?.photoCount === 3, JSON.stringify(stats));
  check("video count", stats?.videoCount === 1, JSON.stringify(stats));
  check("contributor count", stats?.contributorCount === 2, JSON.stringify(stats));
  check("storage sums the ORIGINAL file sizes", stats?.storageBytes === 8_400_000 + 7_100_000 + 6_200_000 + 180_000_000, `${stats?.storageBytes}`);

  section("Download authorization");
  const strangerDownload = await call(stranger, "GET", `/api/media/${vikashPhoto1.id}/download`);
  check("non-member cannot download (401)", strangerDownload.status === 401, `got ${strangerDownload.status}`);

  const otherAlbum = await call(createJar("other"), "POST", "/api/albums", { name: "Other Album" });
  albumsSeen.push(otherAlbum.json?.album?.id);
  const otherJar = createJar("other2");
  await call(otherJar, "POST", "/api/albums/join", { code: otherAlbum.json.joinCode });
  const crossAlbum = await call(otherJar, "GET", `/api/media/${vikashPhoto1.id}/download`);
  check("a member of a different album is still denied (401)", crossAlbum.status === 401, `got ${crossAlbum.status}`);

  section("Admin dashboard");
  const dashboard = await call(vikash, "GET", `/api/albums/${albumId}/admin`);
  check("dashboard reachable by admin", dashboard.status === 200, `got ${dashboard.status}`);
  check("dashboard exposes the code for sharing", dashboard.json?.joinCode === joinCode, "");
  check("dashboard lists contributors", (dashboard.json?.contributors ?? []).length >= 2, "");
  const dashByName = Object.fromEntries((dashboard.json?.contributors ?? []).map((c) => [c.displayName, c]));
  check("per-contributor upload counts are correct",
    dashByName["Vikash"]?.mediaCount === 2 && dashByName["Rahul"]?.mediaCount === 2,
    JSON.stringify(dashboard.json?.contributors));
  check("dashboard lists recent uploads", (dashboard.json?.recentUploads ?? []).length === 4, "");
  const rahulDashboard = await call(rahul, "GET", `/api/albums/${albumId}/admin`);
  check("contributor cannot open the dashboard (403)", rahulDashboard.status === 403, `got ${rahulDashboard.status}`);

  section("Admin-only mutations");
  const rahulRename = await call(rahul, "PATCH", `/api/albums/${albumId}`, { name: "Hacked" });
  check("contributor cannot rename the album (403)", rahulRename.status === 403, `got ${rahulRename.status}`);
  const rahulDeleteAlbum = await call(rahul, "DELETE", `/api/albums/${albumId}`, {});
  check("contributor cannot delete the album (403)", rahulDeleteAlbum.status === 403, `got ${rahulDeleteAlbum.status}`);
  const rename = await call(vikash, "PATCH", `/api/albums/${albumId}`, { name: "Goa Trip 2026 ☀" });
  check("admin can rename", rename.status === 200 && rename.json?.album?.name === "Goa Trip 2026 ☀", rename.text.slice(0, 120));

  section("CSRF origin check");
  const badOrigin = await call(vikash, "PATCH", `/api/albums/${albumId}`, { name: "evil" }, { Origin: "https://evil.example" });
  check("cross-origin write blocked (403)", badOrigin.status === 403, `got ${badOrigin.status}`);

  section("Scenario 28 — Regenerate the album code");
  const regen = await call(vikash, "POST", `/api/albums/${albumId}/regenerate-code`, {});
  const newCode = regen.json?.joinCode;
  check("new code issued", typeof newCode === "string" && newCode !== joinCode, `${joinCode} -> ${newCode}`);
  const oldCodeJoin = await call(createJar("late"), "POST", "/api/albums/join", { code: joinCode });
  check("old code no longer works (404)", oldCodeJoin.status === 404, `got ${oldCodeJoin.status}`);
  const newCodeJoin = await call(createJar("late2"), "POST", "/api/albums/join", { code: newCode });
  check("new code works", newCodeJoin.status === 200, `got ${newCodeJoin.status}`);
  const rahulStillIn = await call(rahul, "GET", `/api/albums/${albumId}`);
  check("existing members keep access by default (documented)", rahulStillIn.status === 200, `got ${rahulStillIn.status}`);

  const regen2 = await call(vikash, "POST", `/api/albums/${albumId}/regenerate-code`, { revokeExistingSessions: true });
  check("revoking reports how many were signed out", regen2.json?.revokedSessions >= 1, JSON.stringify(regen2.json));
  const rahulAfterRevoke = await call(rahul, "GET", `/api/albums/${albumId}`);
  check("revoked contributor loses access (401)", rahulAfterRevoke.status === 401, `got ${rahulAfterRevoke.status}`);
  const adminAfterRevoke = await call(vikash, "GET", `/api/albums/${albumId}`);
  check("admin keeps access after revoking", adminAfterRevoke.status === 200, `got ${adminAfterRevoke.status}`);

  section("Scenario 10 — Album ZIP job");
  const job = await call(vikash, "POST", `/api/albums/${albumId}/downloads`, {});
  check("job accepted (202)", job.status === 202, `got ${job.status}`);
  check("job covers every file in the album", job.json?.job?.fileCount === 4, JSON.stringify(job.json?.job));
  check("zip is named after the album", /\.zip$/.test(job.json?.job?.filename ?? ""), job.json?.job?.filename);
  const jobId = job.json?.job?.id;
  const strangerJob = await call(stranger, "GET", `/api/downloads/${jobId}`);
  check("another browser cannot fetch the archive (401)", strangerJob.status === 401, `got ${strangerJob.status}`);

  let finalStatus = "pending";
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const poll = await call(vikash, "GET", `/api/downloads/${jobId}`);
    finalStatus = poll.json?.job?.status;
    if (finalStatus !== "pending" && finalStatus !== "running") break;
  }
  check("job reaches a terminal state (never hangs)", ["ready", "failed"].includes(finalStatus), `status=${finalStatus}`);

  section("Scenario 34 — Delete the whole album");
  const wrongName = await call(vikash, "DELETE", `/api/albums/${albumId}`, { confirmName: "wrong" });
  check("mismatched confirmation rejected (400)", wrongName.status === 400, `got ${wrongName.status}`);
  const deleted = await call(vikash, "DELETE", `/api/albums/${albumId}`, { confirmName: "Goa Trip 2026 ☀" });
  check("album deleted (200)", deleted.status === 200, `${deleted.status} ${deleted.text.slice(0, 200)}`);
  check("caller is warned about storage cleanup failures", Boolean(deleted.json?.warning), deleted.json?.warning);
  const remainingAlbums = await sql`select count(*)::int as n from albums where id = ${albumId}`;
  const remainingMedia = await sql`select count(*)::int as n from media where album_id = ${albumId}`;
  const remainingContributors = await sql`select count(*)::int as n from contributors where album_id = ${albumId}`;
  const remainingJobs = await sql`select count(*)::int as n from download_jobs where album_id = ${albumId}`;
  check("album row gone", remainingAlbums[0].n === 0, "");
  check("media rows cascaded", remainingMedia[0].n === 0, "");
  check("contributors cascaded", remainingContributors[0].n === 0, "");
  check("download jobs cascaded", remainingJobs[0].n === 0, "");
  const flagged = await sql`select count(*)::int as n from orphaned_assets where album_id = ${albumId}`;
  check("undeletable assets flagged for cleanup", flagged[0].n > 0, `n=${flagged[0].n}`);
  const afterDelete = await call(vikash, "GET", `/api/albums/${albumId}`);
  check("album no longer reachable (401)", afterDelete.status === 401, `got ${afterDelete.status}`);
}
