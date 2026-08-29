# Integration tests

These run the **real application** — real Express, real Drizzle, real
PostgreSQL — and walk the scenarios from the specification end to end.

```bash
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/shared_album_test npm test
```

The runner boots its own app instances on free ports, so nothing needs to be
running first. It deletes the albums it creates, but it does write to the
database — point it at a scratch database, never at anything you care about.

## What runs where

The runner starts two instances of the app, because the two halves of the
Cloudinary contract are best tested under opposite conditions.

**Instance A — deliberately invalid Cloudinary credentials.**
Every storage call fails. That is the point: it proves that a failed delete
surfaces as an error and *keeps* the database row and an `orphaned_assets`
record, rather than reporting a success that leaves a file behind.

- `integration/01-albums.test.mjs` — create, join, permissions, admin-only
  operations, code regeneration, CSRF, album deletion, no-enumeration
- `integration/02-downloads.test.mjs` — signature correctness, original
  downloads, range requests, ZIP fidelity

**Instance B — pointed at `helpers/mock-cloudinary.mjs`.**
The mock validates upload signatures exactly the way Cloudinary does (sorted
params + API secret, SHA-1), so a change to the signed parameter set fails the
tests instead of silently breaking uploads in production.

- `integration/03-uploads.test.mjs` — the full upload → verify → gallery →
  delete loop, duplicate detection, forged registrations, rate limiting

## Notes

- `02-downloads` shells out to `unzip` to inspect archives, and compares the
  extracted bytes against the uploaded bytes. It is the test that proves no
  re-encoding happens anywhere in the download path.
- `03-uploads` needs `openssl` to mint a certificate for the mock (the
  Cloudinary SDK always speaks https to its API). If openssl is unavailable
  the runner skips that suite and says so rather than failing.
- Rate limiting is disabled in development unless `RATE_LIMIT_IN_DEV=1`; the
  runner sets it only for the instance whose suite tests it.

## Adding a suite

Export a `name` and an async `run(ctx)`:

```js
export const name = "My suite";

export async function run({ call, sql, check, section, createJar, albumsSeen }) {
  section("Something worth grouping");
  const jar = createJar("alice");
  const res = await call(jar, "POST", "/api/albums", { name: "Test" });
  albumsSeen.push(res.json.album.id); // so the runner cleans it up
  check("album created", res.status === 201, `got ${res.status}`);
}
```

Then add it to the suite list in `run.mjs`.
