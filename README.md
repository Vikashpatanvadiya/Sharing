# Shared Album

Private shared photo & video albums for groups. One album per trip, wedding,
festival or family gathering: create it, share a six-character code, and
everyone with the code can upload, view and download the memories.

```
        HOME
          |
   +------+------+
   |             |
CREATE        JOIN
   |             |
Generate      Enter
  code         code
   |             |
   +------+------+
          |
     ALBUM PAGE
          |
   +------+------+
   |             |
 UPLOAD        VIEW
   |             |
Cloudinary   Gallery
   |             |
   +------+------+
          |
  DOWNLOAD ORIGINAL
```

No accounts. No public browsing. No discovery feed. The code is the door.

---

## Contents

- [The two rules that shape everything](#the-two-rules-that-shape-everything)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Commands](#commands)
- [Permission model](#permission-model)
- [Security](#security)
- [Upload flow](#upload-flow)
- [Delete flow](#delete-flow)
- [Download flow](#download-flow)
- [API reference](#api-reference)
- [Deployment](#deployment)
- [Operations](#operations)
- [Testing](#testing)

---

## The two rules that shape everything

**1. The original file is never modified.**

Uploads carry no transformation, no eager derivation, no format coercion and no
`overwrite` flag. A 12 MB HEIC stays a 12 MB HEIC; a 250 MB MOV stays a 250 MB
MOV. Nothing in the codebase converts HEIC to JPG or MOV to MP4 on ingest.

The gallery and the lightbox use Cloudinary *delivery* transformations — URLs
that ask the CDN to derive a smaller representation on the fly. The stored
asset is untouched by them, and every download path returns the stored asset.

```
Original asset (Cloudinary)
      |
      +-- Gallery preview  -> derived on delivery, cached on the CDN
      |
      +-- Download         -> the original bytes, byte for byte
```

**2. Deleting means deleting from both places.**

A delete removes the Cloudinary asset *and* the database row. If Cloudinary
refuses, the database row is deliberately kept and the caller gets an error —
the app never reports a success that leaves a file behind, still costing
storage, invisible to everyone.

---

## Tech stack

| Layer     | Choice                                             |
| --------- | -------------------------------------------------- |
| Frontend  | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Routing   | wouter                                             |
| Data      | TanStack Query                                     |
| Backend   | Node.js, Express, TypeScript                       |
| Database  | PostgreSQL + Drizzle ORM                           |
| Storage   | Cloudinary (signed direct upload)                  |
| Archives  | archiver (server-side ZIP, stored not deflated)    |
| Validation| Zod                                                |

---

## Architecture

```
/
├── client/
│   └── src/
│       ├── components/     # Gallery, Lightbox, UploadPanel, AdminPanel, ui/
│       ├── pages/          # Home, CreateAlbum, JoinAlbum, Album
│       ├── hooks/          # use-album, use-upload, use-download, use-toast
│       └── lib/            # api client, upload queue, formatters, share
│
├── server/
│   ├── routes/             # albums, media, downloads
│   ├── middleware/         # auth, session, csrf, rateLimit, error
│   ├── services/           # cloudinary, albums, media, downloads
│   ├── db/                 # schema, client, migrate
│   └── lib/                # crypto, errors, logger, media-types
│
├── shared/types/           # the client/server contract
├── tests/                  # integration suites + the mock Cloudinary
├── drizzle/                # generated SQL migrations
├── render.yaml             # Render blueprint
└── .env.example
```

The client and API are served from **one origin** (Vite middleware in dev,
static files in production), so session cookies are always first-party.

Business logic lives in `server/services`. React components render state and
call `client/src/lib/api.ts`; they contain no upload, authorization or
Cloudinary logic of their own.

---

## Local setup

**Prerequisites:** Node 20+, a PostgreSQL 14+ database, a Cloudinary account.

```bash
git clone <your-repo> shared-album && cd shared-album
npm install
cp .env.example .env
```

### PostgreSQL

Any Postgres works — local, Docker, Neon, Supabase, RDS.

```bash
createdb shared_album
```

Then set `DATABASE_URL` in `.env`:

```
DATABASE_URL=postgresql://user:password@localhost:5432/shared_album
```

Hosted providers (Neon, Supabase, RDS, …) work as-is: any non-local host gets
TLS automatically, whether or not the connection string carries
`?sslmode=require`. Add `?sslmode=disable` to opt out.

A Neon connection string looks like:

```
DATABASE_URL=postgresql://neondb_owner:PASSWORD@ep-something-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
```

Apply the schema:

```bash
npm run db:migrate
```

`db:migrate` runs the committed SQL in `drizzle/`. Use `npm run db:push` only
for throwaway development databases — it diffs the schema directly and skips
the migration history.

### Cloudinary

1. Create an account and open **Settings → API Keys**.
2. Copy the cloud name, API key and API secret into `.env`.
3. No upload preset is needed: every upload is signed server-side.

Assets are organised per album:

```
shared-albums/
    album_<album-uuid>/
        aB3xK9mQ2pL7
        Rt5vN8wZ1cY4
        ...
```

Public IDs are random, so a Cloudinary URL cannot be guessed from an album name
or a filename.

### Run it

```bash
npm run dev
```

Open <http://localhost:3000>.

> **macOS:** port 5000 is occupied by AirPlay Receiver (it appears as
> `ControlCenter` in `lsof -nP -iTCP:5000 -sTCP:LISTEN`). The project defaults
> to 3000 for that reason; either port works if `PORT` and `PUBLIC_ORIGIN`
> agree.

---

## Environment variables

| Variable                | Required | Description                                                        |
| ----------------------- | -------- | ------------------------------------------------------------------ |
| `DATABASE_URL`          | yes      | PostgreSQL connection string                                        |
| `CLOUDINARY_CLOUD_NAME` | yes      | Cloudinary cloud name                                               |
| `CLOUDINARY_API_KEY`    | yes      | Cloudinary API key                                                  |
| `CLOUDINARY_API_SECRET` | yes      | **Server only.** Never sent to the browser                          |
| `CLOUDINARY_FOLDER`     | no       | Root folder for assets (default `shared-albums`)                    |
| `SESSION_SECRET`        | yes      | ≥32 chars. All session and album-code keys derive from it           |
| `MAX_IMAGE_SIZE_MB`     | no       | Per-photo limit (default 100)                                       |
| `MAX_VIDEO_SIZE_MB`     | no       | Per-video limit (default 2000)                                      |
| `PORT`                  | no       | Default 3000 (5000 is AirPlay Receiver on macOS)                     |
| `PUBLIC_ORIGIN`         | yes*     | Public origin(s), comma-separated. Used for share links and CSRF    |
| `DOWNLOAD_TMP_DIR`      | no       | Where prepared ZIPs are staged (default `./tmp/downloads`)          |
| `DOWNLOAD_TTL_MINUTES`  | no       | How long a prepared ZIP stays downloadable (default 30)             |
| `CLOUDINARY_API_BASE`   | no       | Override the Cloudinary API host (regional endpoints, test mocks)   |

\* Required in production; defaults to `http://localhost:3000` in development.

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`.env` is git-ignored. Only `.env.example` is committed.

> **Rotating `SESSION_SECRET` is destructive.** Every album code is encrypted at
> rest with a key derived from it, and every session credential is hashed with
> another. Rotating it signs everyone out *and* makes existing album codes
> unrecoverable for their admins. Treat it as permanent for a given deployment.

---

## Commands

| Command               | Description                                        |
| --------------------- | -------------------------------------------------- |
| `npm run dev`         | Dev server: API + Vite middleware on one origin     |
| `npm run build`       | Build client to `dist/public`, server to `dist/server` |
| `npm start`           | Run the production build                           |
| `npm run check`       | TypeScript across client, server and shared         |
| `npm test`            | Integration suite (needs `TEST_DATABASE_URL`)        |
| `npm run db:generate` | Generate a migration from schema changes            |
| `npm run db:migrate`  | Apply migrations                                    |
| `npm run db:push`     | Push the schema directly (development only)         |
| `npm run db:studio`   | Drizzle Studio                                      |

---

## Permission model

There are no user accounts. Identity is per-album and comes from a signed,
httpOnly cookie that carries a *credential*, never a claim — the server always
re-verifies it against a hash in the database.

|                              | Contributor | Admin |
| ---------------------------- | :---------: | :---: |
| View the album               | ✓ | ✓ |
| Upload photos and videos     | ✓ | ✓ |
| Download originals           | ✓ | ✓ |
| Download the whole album     | ✓ | ✓ |
| Delete **their own** uploads | ✓ | ✓ |
| Delete anyone's uploads      | ✗ | ✓ |
| Rename / edit the album      | ✗ | ✓ |
| Regenerate the album code    | ✗ | ✓ |
| See album statistics         | ✗ | ✓ |
| Delete the album             | ✗ | ✓ |

A contributor who selects a mixture of their own and other people's photos and
taps delete has only their own removed; the response says so explicitly.

### Album code regeneration — documented behaviour

Regenerating the code invalidates the old code **for new joins**. People who
already joined keep their access by default, because their session is an
independent credential and evicting everyone is rarely what the admin means.

The admin can additionally tick **"Also sign out everyone who already joined"**,
which rotates every contributor's session identifier. Everyone then needs the
new code to get back in. Uploads are never affected either way, and the admin's
own session always survives.

---

## Security

- **Album codes** are 6 characters from a 29-symbol alphabet with the ambiguous
  glyphs (`0/O`, `1/I/L`, `U/V`) removed, drawn from `crypto.randomBytes` with
  rejection sampling so the distribution is uniform.
- **Codes are never stored in plaintext.** Each album stores a keyed HMAC of the
  code (used for both lookup and verification, so a database dump alone cannot
  be reversed with a rainbow table) plus an AES-256-GCM ciphertext, which is
  what lets a verified admin re-read and re-share their own code.
- **The admin credential is separate from the join code.** Creating an album
  mints a random 32-byte token, stores only its hash, and puts the token in an
  httpOnly cookie. Knowing the join code never grants admin.
- **Sessions** are signed httpOnly, SameSite=Lax cookies (`Secure` in
  production). They carry secrets that are matched against database hashes on
  every request; a forged or edited cookie grants nothing.
- **CSRF**: SameSite=Lax plus an origin check on every state-changing request.
- **Rate limiting** on code attempts (12 per 10 minutes), album creation,
  upload authorization, deletes, downloads and admin operations.
- **Authorization is always server-side.** `contributor_id` from a request body
  is never trusted; identity is derived from the session. Ownership is checked
  again for every item in a bulk operation.
- **No album enumeration**: a wrong code and a non-existent album return the
  same 404 with the same message; an album id you lack access to returns 401
  whether or not it exists.
- **Uploads are verified.** After the browser reports a successful upload, the
  server re-reads the asset through Cloudinary's Admin API. Size, dimensions,
  duration and checksum all come from Cloudinary, so a client cannot understate
  a file size to dodge the limit or register an asset it never uploaded. A
  `public_id` outside the album's own folder is rejected with 403.
- **`CLOUDINARY_API_SECRET` never reaches the browser.** The client receives
  only a per-file signature valid for one pre-assigned `public_id`.
- **Originals are never exposed as raw storage URLs.** The browser receives
  unguessable CDN URLs for *previews* only; every original is served through an
  authorized app endpoint with `Cache-Control: private, no-store`.
- **Input validation** with Zod on every route, plus a format allowlist and
  configurable size limits.
- Users never see database or storage internals; technical detail is logged
  server-side and the response carries a plain-English sentence.

---

## Upload flow

```
Browser                    Server                  Cloudinary        Postgres
   |                          |                        |                |
   |-- request signatures --->|                        |                |
   |   (name, type, size)     |                        |                |
   |                     validate each                  |                |
   |                     file individually              |                |
   |<-- signed tickets -------|                        |                |
   |    (+ per-file rejections)                        |                |
   |                                                   |                |
   |-- POST file directly ---------------------------->|                |
   |<-- asset info ------------------------------------|                |
   |                          |                        |                |
   |-- confirm upload ------->|                        |                |
   |                          |-- read asset back ---->|                |
   |                          |<-- size, dims, etag ---|                |
   |                          |-- insert media row -------------------->|
   |<-- gallery item ---------|                        |                |
```

The upload queue (`client/src/lib/upload-queue.ts`) runs three transfers at a
time, fetches signatures 25 at a time, and coalesces progress events into one
React update per frame — selecting 200 photos never blocks the main thread.
It falls back to a timer when the tab is backgrounded, so progress keeps
updating while someone is in another app.

Per-file behaviour:

- One failure fails one file. The rest of the queue continues.
- A batch containing an unsupported or oversized file still signs the valid
  ones; only the offending files are marked failed, each with its own reason.
- Failures show a retry button — except permanent ones (wrong format, over the
  limit), where a retry could not help.
- Cancelling a transfer that already reached Cloudinary tells the server to
  discard the orphaned asset.
- Duplicate detection uses Cloudinary's content hash. A duplicate prompts
  "Upload anyway / Cancel"; the existing original is never touched, and
  cancelling removes only the new copy.

---

## Delete flow

```
User clicks Delete
        |
Confirmation dialog  ("This permanently deletes the original")
        |
Server verifies session identity
        |
Media belongs to this album?
        |
Uploader == caller, or caller is admin?
        |            \
       yes            no --> 403, nothing is touched
        |
Destroy the Cloudinary asset
        |            \
       ok             failed --> record in orphaned_assets,
        |                        keep the database row,
        |                        return 502
Delete the database row
        |
Gallery updates
```

Album deletion empties Cloudinary in batches by resource type first, then
cascades the media, contributor and download-job rows away. Assets Cloudinary
refuses to delete are recorded in `orphaned_assets` and the admin is told that
storage cleanup was incomplete — the deletion still completes, because leaving
a half-deleted album the admin cannot retry would be worse.

---

## Download flow

**One file** — `GET /api/media/:id/download` streams the stored original
through the app with `Content-Disposition: attachment` and the original
filename. `IMG_29381.JPG` downloads as `IMG_29381.JPG`. Range requests are
forwarded, so video seeking works on the inline endpoint.

**Selected files or a whole album** — a server-side job:

```
POST /api/albums/:id/downloads   ->  202 { job }
GET  /api/downloads/:jobId       ->  { status, processedCount, fileCount }
GET  /api/downloads/:jobId/file  ->  the ZIP
```

The archive is streamed to disk one file at a time, so neither the browser nor
the server ever holds the album in memory; a 40 GB album is a disk-space
question, not a RAM question. The UI shows "Preparing your download… you can
keep using the album" and the album stays fully usable.

ZIP entries are **stored, not deflated** (`zlib: { level: 0 }`). Photos and
videos are already compressed, so re-deflating them would burn CPU for nothing —
and it guarantees the bytes inside the archive are the original bytes. Two
people who both uploaded `IMG_001.JPG` get `IMG_001.JPG` and `IMG_001 (2).JPG`;
the contents are untouched.

A prepared archive is bound to the job id, the browser that asked for it, and a
still-valid session for that album. Losing album access revokes the ZIP too.
Archives are deleted from disk after `DOWNLOAD_TTL_MINUTES`.

---

## API reference

All `/api` routes are rate limited and CSRF-checked. Protected routes resolve
the caller's identity from the session cookie.

| Method   | Route                                 | Access      | Purpose                                |
| -------- | ------------------------------------- | ----------- | -------------------------------------- |
| `GET`    | `/api/config`                         | public      | Size limits and accepted formats       |
| `POST`   | `/api/albums`                         | public      | Create an album; returns the code once |
| `POST`   | `/api/albums/join`                    | public      | Join with a code                       |
| `GET`    | `/api/albums/mine`                    | session     | Albums this browser can re-enter       |
| `GET`    | `/api/albums/:id`                     | member      | Album, stats and viewer role           |
| `PATCH`  | `/api/albums/:id`                     | admin       | Rename / edit                          |
| `DELETE` | `/api/albums/:id`                     | admin       | Delete album, media and assets         |
| `POST`   | `/api/albums/:id/identity`            | member      | Set the display name                   |
| `POST`   | `/api/albums/:id/leave`               | member      | Forget this album on this device       |
| `GET`    | `/api/albums/:id/media`               | member      | Gallery page (keyset cursor + filter)  |
| `POST`   | `/api/albums/:id/upload/signature`    | member      | Signed upload tickets                  |
| `POST`   | `/api/albums/:id/media`               | member      | Confirm an upload                      |
| `POST`   | `/api/albums/:id/media/discard`       | member      | Discard an unregistered upload         |
| `GET`    | `/api/albums/:id/admin`               | admin       | Dashboard: stats, code, contributors   |
| `POST`   | `/api/albums/:id/regenerate-code`     | admin       | New code (optionally revoke sessions)  |
| `POST`   | `/api/albums/:id/downloads`           | member      | Start a ZIP job (all or selected)      |
| `GET`    | `/api/media/:id`                      | member      | One item                               |
| `GET`    | `/api/media/:id/original`             | member      | Stream inline (supports Range)         |
| `GET`    | `/api/media/:id/download`             | member      | Download the original                  |
| `DELETE` | `/api/media/:id`                      | owner/admin | Delete one item                        |
| `POST`   | `/api/media/bulk-delete`              | member      | Delete many (per-item authorization)   |
| `GET`    | `/api/downloads/:jobId`               | requester   | Job status                             |
| `GET`    | `/api/downloads/:jobId/file`          | requester   | Fetch the prepared ZIP                 |

Errors are uniform:

```json
{ "error": { "code": "forbidden", "message": "You can only delete photos and videos that you uploaded." } }
```

---

## Deployment

The app is a single long-running Node process that serves both the API and the
built client. Any platform that runs a Node service works: Render, Railway,
Fly.io, a VPS, a container.

> **Serverless platforms (Vercel, Netlify Functions) are not a fit.** Three
> things here need a persistent process: ZIP archives are built in the
> background after the response is sent, they are staged on local disk, and
> originals are streamed through the app so every byte stays authorized. On a
> serverless runtime the function is frozen once it responds, `/tmp` is
> per-instance and ephemeral, and long downloads exceed the execution cap.
> Uploading and browsing would work; downloading would not.

### Render (blueprint included)

`render.yaml` is committed, so **New → Blueprint** and pointing Render at the
repository is enough. It sets the build and start commands, a health check on
`/api/health`, and prompts for the secrets rather than storing them in git.

Set these in the Render dashboard:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | your Neon **pooled** connection string |
| `CLOUDINARY_CLOUD_NAME` | from Cloudinary → Settings → API Keys |
| `CLOUDINARY_API_KEY` | same page |
| `CLOUDINARY_API_SECRET` | same page — server only |
| `SESSION_SECRET` | the same value you use elsewhere (see the warning below) |
| `PUBLIC_ORIGIN` | `https://<your-service>.onrender.com` |

`PORT` is injected by Render; don't set it. `NODE_ENV`, folder and size limits
come from the blueprint.

Two things worth knowing:

- **`PUBLIC_ORIGIN` must match the service URL exactly.** It drives the CSRF
  origin check and the share links, so a mismatch makes every write fail with
  "Request blocked for security reasons".
- **On the free plan the service sleeps when idle and its disk is ephemeral.**
  A prepared ZIP can disappear before it is fetched; the app reports it as
  expired and the user can prepare it again. Attach a disk on a paid instance
  and point `DOWNLOAD_TMP_DIR` at its mount path to make archives durable
  (there is a commented example at the bottom of `render.yaml`).

### Migrations

The schema lives in `drizzle/` and is applied with `npm run db:migrate`. With a
hosted database like Neon you can run that from your own machine against the
same `DATABASE_URL` — it does not need to run on the deployment host, and it is
safe to re-run.

### Any other host

```bash
npm ci
npm run build
npm run db:migrate
npm start
```

`npm run build` produces `dist/public` (client) and `dist/server/index.js`
(server). In production the server serves the built client, so there is one
origin and one process.

Checklist:

- [ ] `NODE_ENV=production`
- [ ] `PUBLIC_ORIGIN` set to the real HTTPS origin (comma-separate if several)
- [ ] A long, random `SESSION_SECRET` that will never be rotated casually
- [ ] `DATABASE_URL` pointing at the production database
- [ ] Migrations applied
- [ ] `MAX_IMAGE_SIZE_MB` / `MAX_VIDEO_SIZE_MB` within your Cloudinary plan
- [ ] `DOWNLOAD_TMP_DIR` on a writable disk with room for the largest album
- [ ] HTTPS terminated in front of the app (cookies are `Secure` in production)

The app sets `trust proxy`, so `req.ip`, secure-cookie detection and rate
limiting behave correctly behind a reverse proxy.

**Horizontal scaling:** sessions are stateless, so any number of app instances
can share a database. ZIP jobs are the exception — the archive is written to the
local disk of the instance that built it, so either run a single instance, use
sticky sessions, or point `DOWNLOAD_TMP_DIR` at shared storage.

## Operations

**Orphaned assets.** Any Cloudinary object the app failed to delete is recorded
in `orphaned_assets` with the reason and a timestamp. It is an audit trail, not
a queue: nothing retries automatically.

```sql
select cloudinary_public_id, cloudinary_resource_type, reason, created_at
from orphaned_assets
where resolved_at is null
order by created_at;
```

After cleaning one up, mark it resolved with
`update orphaned_assets set resolved_at = now() where id = '...'`.

**Prepared downloads** are cleaned from disk and the database every 10 minutes
once past their TTL.

**Storage figures** in the UI are the sum of the original uploaded file sizes in
the database. CDN-derived previews are not counted, because they are not
something anyone uploaded.

**Themes.** The design tokens in `client/src/index.css` include a complete dark
palette under `.dark`, but nothing toggles it — the app ships light-only by
design. Adding a theme switch is a matter of putting `class="dark"` on `<html>`.

---

## Testing

```bash
npm run check    # TypeScript across client, server and shared
TEST_DATABASE_URL=postgresql://... npm test   # integration suite
```

`npm test` runs the real application — real Express, real Drizzle, real
PostgreSQL — through the scenarios below. It boots its own app instances on
free ports, so nothing needs to be running first, and it deletes the albums it
creates. Point it at a scratch database; it writes to whatever you give it.

Two instances are used, because the two halves of the Cloudinary contract are
best tested under opposite conditions: one with deliberately invalid
credentials (so every storage call fails, proving that failures are reported
honestly rather than papered over) and one against a mock that validates upload
signatures exactly the way Cloudinary does. See `tests/README.md` for the
layout.

Current status: **152 assertions, all passing.** Coverage of the required
scenarios:

| Scenario                                    | Result                                                         |
| ------------------------------------------- | -------------------------------------------------------------- |
| 1. Create album                             | Album created, 6-char code generated, admin session issued      |
| 2. Join with the correct code               | Access granted, album visible, joined as contributor            |
| 3. Join with an incorrect code              | Denied, with a message that reveals nothing                     |
| 4. User A uploads a photo                   | Cloudinary asset stored unmodified, row created, attributed to A |
| 5. User A deletes their own photo           | Cloudinary asset destroyed, row deleted, gone from the gallery  |
| 6. User B deletes User A's photo            | 403; asset and row both untouched, no storage call attempted    |
| 7. Admin deletes User A's photo             | Asset destroyed, row deleted                                    |
| 8. Download one photo                       | Byte-identical original, original filename preserved            |
| 9. Download selected photos                 | ZIP of originals, stored not re-encoded, byte-compared          |
| 10. Download the whole album                | All photos and videos included as originals                     |
| 11. Upload many files                       | Queue stays responsive; one failure does not stop the others    |
| 12. Access an album without a code          | Denied on both the album and the gallery                        |

Also verified: HEIC and MOV survive upload and download unconverted; a mixed
batch signs the valid files and rejects only the invalid ones; duplicate
detection keeps the existing original; cross-album access is refused; ZIP jobs
are bound to the requesting browser; code regeneration behaves as documented in
both modes; album deletion leaves no orphaned assets; brute-forcing codes is
rate limited; and a storage failure during delete returns an error and keeps the
database row rather than reporting a false success.
