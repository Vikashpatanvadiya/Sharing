/**
 * Hosted Postgres (Neon, Supabase, RDS, …) requires TLS, and a connection
 * string pasted without `?sslmode=require` otherwise fails with an opaque
 * error. Anything that is not a local socket gets TLS by default; an explicit
 * `sslmode=disable` still wins.
 */
export function sslSetting(url: string): "require" | undefined {
  if (/sslmode=disable/.test(url)) return undefined;
  if (/sslmode=(require|verify-full|verify-ca|prefer)/.test(url)) return "require";
  try {
    const { hostname } = new URL(url);
    const isLocal =
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "";
    return isLocal ? undefined : "require";
  } catch {
    return undefined;
  }
}
