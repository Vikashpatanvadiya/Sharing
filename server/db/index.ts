import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.js";
import * as schema from "./schema.js";
import { sslSetting } from "./ssl.js";

/**
 * A single pooled connection for the process. `postgres.js` handles pooling,
 * prepared statements and reconnection; we only tune the ceiling so a burst of
 * uploads cannot exhaust the database.
 */
const client = postgres(env.DATABASE_URL, {
  max: env.isProduction ? 12 : 5,
  /**
   * Hosted Postgres (Neon and friends) closes idle connections, and a laptop
   * that sleeps or changes network leaves sockets that look alive but are not.
   * Without these, the first request after such a blip blocks on a dead socket
   * until the OS gives up — observed at 66 seconds, which the user experiences
   * as the app hanging with no error at all.
   */
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  connect_timeout: 10,
  // Detect a half-open socket in ~20s instead of waiting for a TCP timeout.
  keep_alive: 20,
  ssl: sslSetting(env.DATABASE_URL),
  onnotice: () => {},
});

export const db = drizzle(client, { schema });
export const sqlClient = client;
export { schema };

export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
