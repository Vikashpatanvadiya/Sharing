/**
 * Per-photo visibility.
 *
 * The rule has to hold everywhere media is read — the gallery, the counts, a
 * direct fetch, the download proxy, bulk delete and the album ZIP — not just in
 * the grid. A photo that is merely hidden in the UI is not private.
 */
export const name = "Per-photo visibility";

export async function run({ call, sql, check, section, createJar, albumsSeen }) {
  const alice = createJar("alice"); // album creator / admin
  const bob = createJar("bob");
  const carol = createJar("carol");

  const created = await call(alice, "POST", "/api/albums", {
    name: "Visibility Album",
    creatorName: "Alice",
  });
  const albumId = created.json.album.id;
  albumsSeen.push(albumId);
  const code = created.json.joinCode;

  await call(bob, "POST", "/api/albums/join", { code, displayName: "Bob" });
  await call(carol, "POST", "/api/albums/join", { code, displayName: "Carol" });

  const [aliceRow] = await sql`
    select * from contributors where album_id = ${albumId} and is_admin = 1 limit 1`;
  const [bobRow] = await sql`
    select * from contributors where album_id = ${albumId} and display_name = 'Bob' limit 1`;
  const [carolRow] = await sql`
    select * from contributors where album_id = ${albumId} and display_name = 'Carol' limit 1`;

  async function seed(contributor, filename, bytes = 1000, resourceType = "image") {
    const [row] = await sql`
      insert into media (album_id, contributor_id, uploader_name, cloudinary_public_id,
        cloudinary_resource_type, cloudinary_secure_url, original_filename, format,
        mime_type, file_size)
      values (${albumId}, ${contributor.id}, ${contributor.display_name},
        ${`shared-albums/album_${albumId}/${filename.replace(/\W/g, "")}`},
        ${resourceType}, ${"https://res.cloudinary.com/demo/x"}, ${filename}, ${"jpg"},
        ${"image/jpeg"}, ${bytes})
      returning *`;
    return row;
  }

  // Bob uploads three photos; one of them he will restrict to Carol.
  const open1 = await seed(bobRow, "OPEN_1.jpg");
  const open2 = await seed(bobRow, "OPEN_2.jpg");
  const secret = await seed(bobRow, "SECRET.jpg", 5000);

  section("Everything starts visible to the whole album");
  const before = await call(carol, "GET", `/api/albums/${albumId}/media`);
  check("Carol sees all three", before.json?.items?.length === 3, `${before.json?.items?.length}`);
  const carolStatsBefore = (await call(carol, "GET", `/api/albums/${albumId}`)).json?.album?.stats;
  check("counts include all three", carolStatsBefore?.mediaCount === 3, JSON.stringify(carolStatsBefore));

  section("Bob restricts one photo to Carol only");
  const restrict = await call(bob, "PATCH", `/api/media/${secret.id}/visibility`, {
    restricted: true,
    contributorIds: [carolRow.id],
  });
  check("visibility updated (200)", restrict.status === 200, `${restrict.status} ${restrict.text?.slice(0, 200)}`);
  check("reported as restricted", restrict.json?.media?.visibility === "restricted", "");
  check("audience is Carol", restrict.json?.media?.visibleTo?.join() === carolRow.id, JSON.stringify(restrict.json?.media?.visibleTo));

  section("Carol (on the list) still sees it");
  const carolGallery = await call(carol, "GET", `/api/albums/${albumId}/media`);
  check("still three in Carol's gallery", carolGallery.json?.items?.length === 3, `${carolGallery.json?.items?.length}`);
  const carolFetch = await call(carol, "GET", `/api/media/${secret.id}`);
  check("Carol can open it directly", carolFetch.status === 200, `${carolFetch.status}`);
  const carolDownload = await call(carol, "GET", `/api/media/${secret.id}/download`);
  check("Carol can download it", carolDownload.status !== 404 && carolDownload.status !== 401, `${carolDownload.status}`);

  section("A third member is excluded everywhere");
  const dave = createJar("dave");
  await call(dave, "POST", "/api/albums/join", { code, displayName: "Dave" });

  const daveGallery = await call(dave, "GET", `/api/albums/${albumId}/media`);
  const daveNames = (daveGallery.json?.items ?? []).map((i) => i.originalFilename);
  check("hidden from Dave's gallery", !daveNames.includes("SECRET.jpg"), JSON.stringify(daveNames));
  check("Dave sees the other two", daveGallery.json?.items?.length === 2, `${daveGallery.json?.items?.length}`);
  check("page total excludes it", daveGallery.json?.total === 2, `${daveGallery.json?.total}`);

  const daveStats = (await call(dave, "GET", `/api/albums/${albumId}`)).json?.album?.stats;
  check("album counts exclude it for Dave", daveStats?.mediaCount === 2, JSON.stringify(daveStats));
  check("storage total excludes it for Dave", daveStats?.storageBytes === 2000, `${daveStats?.storageBytes}`);

  const daveFetch = await call(dave, "GET", `/api/media/${secret.id}`);
  check("direct fetch is 404, not 403 (existence not disclosed)", daveFetch.status === 404, `${daveFetch.status}`);

  const daveDownload = await call(dave, "GET", `/api/media/${secret.id}/download`);
  check("download refused", daveDownload.status === 404, `${daveDownload.status}`);

  const daveOriginal = await call(dave, "GET", `/api/media/${secret.id}/original`);
  check("inline stream refused", daveOriginal.status === 404, `${daveOriginal.status}`);

  const daveDelete = await call(dave, "DELETE", `/api/media/${secret.id}`);
  check("delete refused", daveDelete.status === 404, `${daveDelete.status}`);

  const daveBulk = await call(dave, "POST", "/api/media/bulk-delete", {
    mediaIds: [secret.id, open1.id],
  });
  const secretOutcome = (daveBulk.json?.failed ?? []).find((f) => f.id === secret.id);
  check("bulk delete reports it as not found", secretOutcome?.reason === "not_found", JSON.stringify(daveBulk.json));
  const [secretStillThere] = await sql`select * from media where id = ${secret.id}`;
  check("restricted row untouched by the bulk attempt", Boolean(secretStillThere), "");

  section("Album ZIPs respect it");
  const daveJob = await call(dave, "POST", `/api/albums/${albumId}/downloads`, {});
  check("Dave's album ZIP has 2 files", daveJob.json?.job?.fileCount === 2, JSON.stringify(daveJob.json?.job));
  const carolJob = await call(carol, "POST", `/api/albums/${albumId}/downloads`, {});
  check("Carol's album ZIP has 3 files", carolJob.json?.job?.fileCount === 3, JSON.stringify(carolJob.json?.job));
  const daveSelected = await call(dave, "POST", `/api/albums/${albumId}/downloads`, {
    mediaIds: [secret.id, open1.id],
  });
  check("selecting a hidden id silently drops it", daveSelected.json?.job?.fileCount === 1, JSON.stringify(daveSelected.json?.job));

  section("The uploader and the admin always keep access");
  const bobFetch = await call(bob, "GET", `/api/media/${secret.id}`);
  check("uploader still sees it", bobFetch.status === 200, `${bobFetch.status}`);
  const aliceFetch = await call(alice, "GET", `/api/media/${secret.id}`);
  check("admin still sees it", aliceFetch.status === 200, `${aliceFetch.status}`);
  const aliceGallery = await call(alice, "GET", `/api/albums/${albumId}/media`);
  check("admin gallery shows everything", aliceGallery.json?.items?.length === 3, `${aliceGallery.json?.items?.length}`);

  section("Only the uploader or admin may change the audience");
  const daveRestrict = await call(dave, "PATCH", `/api/media/${open1.id}/visibility`, {
    restricted: true,
    contributorIds: [carolRow.id],
  });
  check("a non-owner cannot restrict someone else's photo", daveRestrict.status === 403, `${daveRestrict.status}`);
  const adminRestrict = await call(alice, "PATCH", `/api/media/${open2.id}/visibility`, {
    restricted: true,
    contributorIds: [carolRow.id],
  });
  check("admin can restrict anyone's photo", adminRestrict.status === 200, `${adminRestrict.status}`);

  section("Outsiders cannot be added to an audience");
  const other = await call(createJar("outsider"), "POST", "/api/albums", { name: "Other Album" });
  albumsSeen.push(other.json.album.id);
  const [outsider] = await sql`
    select * from contributors where album_id = ${other.json.album.id} limit 1`;
  const crossAlbum = await call(bob, "PATCH", `/api/media/${secret.id}/visibility`, {
    restricted: true,
    contributorIds: [outsider.id, carolRow.id],
  });
  check("request succeeds", crossAlbum.status === 200, `${crossAlbum.status}`);
  check(
    "the outsider is dropped from the audience",
    crossAlbum.json?.media?.visibleTo?.join() === carolRow.id,
    JSON.stringify(crossAlbum.json?.media?.visibleTo),
  );

  section("Returning a photo to the whole album");
  const unrestrict = await call(bob, "PATCH", `/api/media/${secret.id}/visibility`, {
    restricted: false,
    contributorIds: [],
  });
  check("back to album-wide", unrestrict.json?.media?.visibility === "album", `${unrestrict.status}`);
  const daveAgain = await call(dave, "GET", `/api/albums/${albumId}/media`);
  const daveNamesAgain = (daveAgain.json?.items ?? []).map((i) => i.originalFilename);
  check("Dave sees it again", daveNamesAgain.includes("SECRET.jpg"), JSON.stringify(daveNamesAgain));
  // OPEN_2 is still restricted to Carol from the admin step above, so Dave
  // should have exactly SECRET and OPEN_1.
  check("and still not the one the admin restricted", !daveNamesAgain.includes("OPEN_2.jpg"), JSON.stringify(daveNamesAgain));
  const rows = await sql`select count(*)::int as n from media_visibility where media_id = ${secret.id}`;
  check("allow-list rows cleaned up", rows[0].n === 0, `${rows[0].n}`);

  section("Deleting a photo clears its allow-list");
  await call(bob, "PATCH", `/api/media/${open1.id}/visibility`, {
    restricted: true,
    contributorIds: [carolRow.id],
  });
  await sql`delete from media where id = ${open1.id}`;
  const orphaned = await sql`select count(*)::int as n from media_visibility where media_id = ${open1.id}`;
  check("cascade removed the rows", orphaned[0].n === 0, `${orphaned[0].n}`);
}
