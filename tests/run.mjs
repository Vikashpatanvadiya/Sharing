import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createClient, createJar, createReporter, waitForServer } from "./helpers/harness.mjs";
import { startMockCloudinary } from "./helpers/mock-cloudinary.mjs";

/**
 * Integration test runner.
 *
 * Boots the real application against a real PostgreSQL database, runs every
 * suite, and tears everything down. Two app instances are used: one with
 * deliberately invalid Cloudinary credentials (to exercise the storage-failure
 * paths honestly) and one pointed at a local mock (to exercise the full upload
 * and delete loop).
 *
 * Usage:
 *   TEST_DATABASE_URL=postgresql://... npm test
 *
 * The database is written to, so point it at a scratch database — never at
 * anything you care about.
 */

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const API_SECRET = "integration-test-secret";

if (!DATABASE_URL) {
  console.error(
    "\nSet TEST_DATABASE_URL (or DATABASE_URL) to a scratch PostgreSQL database.\n" +
      "The runner writes to it and deletes the albums it creates.\n",
  );
  process.exit(1);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function startApp(env) {
  const child = spawn("npx", ["tsx", "server/index.ts"], {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk;
  });
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });
  return { child, getLog: () => log };
}

/** Self-signed certificate for the mock Cloudinary endpoint. */
function ensureCertificate(dir) {
  const key = path.join(dir, "mock-key.pem");
  const cert = path.join(dir, "mock-cert.pem");
  if (fs.existsSync(key) && fs.existsSync(cert)) return dir;
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048",
      "-keyout", path.join(dir, "key.pem"),
      "-out", path.join(dir, "cert.pem"),
      "-days", "2", "-nodes",
      "-subj", "/CN=127.0.0.1",
      "-addext", "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  return dir;
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-album-tests-"));
  const sql = postgres(DATABASE_URL, { max: 4 });
  const albumsSeen = [];
  const teardown = [];
  const allResults = [];

  try {
    /* ---------------------------------------------------------------- */
    /* Instance A: invalid Cloudinary credentials on purpose             */
    /* ---------------------------------------------------------------- */
    const portA = await freePort();
    const baseA = `http://localhost:${portA}`;
    const appA = startApp({
      NODE_ENV: "development",
      PORT: String(portA),
      DATABASE_URL,
      PUBLIC_ORIGIN: baseA,
      SESSION_SECRET: "integration-test-session-secret-please-ignore",
      CLOUDINARY_CLOUD_NAME: "test-cloud",
      CLOUDINARY_API_KEY: "999888777666555",
      CLOUDINARY_API_SECRET: API_SECRET,
      DOWNLOAD_TMP_DIR: path.join(tmpDir, "downloads"),
      RATE_LIMIT_IN_DEV: "",
    });
    teardown.push(() => appA.child.kill());
    await waitForServer(baseA).catch((error) => {
      console.error(appA.getLog());
      throw error;
    });

    const callA = createClient(baseA);
    const rawCallA = async (jar, method, target, body, extra = {}) => {
      const headers = { Origin: baseA, ...extra };
      const cookie = jar.header();
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(`${baseA}${target}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      jar.absorb(response);
      return response;
    };

    for (const modulePath of ["./integration/01-albums.test.mjs", "./integration/02-downloads.test.mjs"]) {
      const suite = await import(modulePath);
      const { results, check, section } = createReporter(suite.name);
      console.log(`\n=== ${suite.name} ===`);
      await suite.run({
        call: callA,
        rawCall: rawCallA,
        sql,
        check,
        section,
        createJar,
        baseUrl: baseA,
        tmpDir,
        apiSecret: API_SECRET,
        albumsSeen,
      });
      allResults.push(results);
    }

    /* ---------------------------------------------------------------- */
    /* Instance B: pointed at a mock Cloudinary that verifies signatures  */
    /* ---------------------------------------------------------------- */
    let mockAvailable = true;
    try {
      ensureCertificate(tmpDir);
    } catch {
      mockAvailable = false;
      console.warn("\nSkipping the upload suite: openssl is needed to create the mock's certificate.");
    }

    if (mockAvailable) {
      const mock = await startMockCloudinary("test-cloud", API_SECRET, tmpDir);
      teardown.push(() => mock.server.close());

      // This suite plays the part of the browser and uploads straight to the
      // mock, which presents a self-signed certificate. Node reads this at
      // socket-creation time, so it is scoped to the mock suite and restored
      // immediately afterwards.
      const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      teardown.push(() => {
        if (previousTlsSetting === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting;
      });

      const portB = await freePort();
      const baseB = `http://localhost:${portB}`;
      const appB = startApp({
        NODE_ENV: "development",
        PORT: String(portB),
        DATABASE_URL,
        PUBLIC_ORIGIN: baseB,
        SESSION_SECRET: "integration-test-session-secret-please-ignore",
        CLOUDINARY_CLOUD_NAME: "test-cloud",
        CLOUDINARY_API_KEY: "999888777666555",
        CLOUDINARY_API_SECRET: API_SECRET,
        CLOUDINARY_API_BASE: `https://127.0.0.1:${mock.port}`,
        DOWNLOAD_TMP_DIR: path.join(tmpDir, "downloads-b"),
        RATE_LIMIT_IN_DEV: "1",
        // The mock presents a self-signed certificate; test-only.
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      });
      teardown.push(() => appB.child.kill());
      await waitForServer(baseB).catch((error) => {
        console.error(appB.getLog());
        throw error;
      });

      const suite = await import("./integration/03-uploads.test.mjs");
      const { results, check, section } = createReporter(suite.name);
      console.log(`\n=== ${suite.name} ===`);
      await suite.run({
        call: createClient(baseB),
        sql,
        check,
        section,
        createJar,
        baseUrl: baseB,
        mock,
        albumsSeen,
      });
      allResults.push(results);
    }
  } finally {
    // Remove only the albums these tests created; cascades clear the rest.
    for (const albumId of albumsSeen) {
      await sql`delete from albums where id = ${albumId}`.catch(() => {});
    }
    await sql.end({ timeout: 5 }).catch(() => {});
    for (const stop of teardown.reverse()) {
      try {
        stop();
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const passed = allResults.reduce((total, r) => total + r.passed, 0);
  const failed = allResults.reduce((total, r) => total + r.failed, 0);

  console.log("\n=== Summary ===");
  for (const result of allResults) {
    console.log(`  ${result.failed ? "FAIL" : "ok  "}  ${result.name}: ${result.passed} passed, ${result.failed} failed`);
    for (const failure of result.failures) console.log(`          - ${failure}`);
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("\nTest run crashed:", error);
  process.exit(1);
});
