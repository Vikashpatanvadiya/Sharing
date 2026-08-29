/**
 * Shared plumbing for the integration suites: a browser-like cookie jar, a
 * JSON request helper, and the assertion counter each suite reports through.
 */

const GREEN = "[32m";
const RED = "[31m";
const RESET = "[0m";

export function createReporter(name) {
  const results = { name, passed: 0, failed: 0, failures: [] };

  const check = (label, condition, detail = "") => {
    if (condition) {
      results.passed += 1;
      console.log(`  ${GREEN}PASS${RESET}  ${label}`);
    } else {
      results.failed += 1;
      results.failures.push(`${label} ${detail}`.trim());
      console.log(`  ${RED}FAIL${RESET}  ${label} ${detail}`);
    }
  };

  const section = (title) => console.log(`\n${title}`);

  return { results, check, section };
}

/**
 * Each jar behaves like one person's browser: it holds cookies across requests
 * and nothing else. Two jars are two independent people.
 */
export function createJar(label = "visitor") {
  const cookies = new Map();
  return {
    label,
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb(response) {
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const idx = pair.indexOf("=");
        cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    },
    has: (name) => cookies.has(name),
    clear: () => cookies.clear(),
  };
}

export function createClient(baseUrl) {
  return async function call(jar, method, path, body, extraHeaders = {}) {
    const headers = { Origin: baseUrl, ...extraHeaders };
    if (jar) {
      const cookie = jar.header();
      if (cookie) headers.Cookie = cookie;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (jar) jar.absorb(response);

    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not every response is JSON (streams, ZIPs) */
    }
    return { status: response.status, json, text, headers: response.headers };
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForServer(baseUrl, { attempts = 60, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(delayMs);
  }
  throw new Error(`Server at ${baseUrl} did not become ready`);
}

/** Polls a download job until it leaves the pending/running states. */
export async function awaitJob(call, jar, jobId, { attempts = 60, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    await sleep(delayMs);
    const poll = await call(jar, "GET", `/api/downloads/${jobId}`);
    const job = poll.json?.job;
    if (job && job.status !== "pending" && job.status !== "running") return job;
  }
  return null;
}
