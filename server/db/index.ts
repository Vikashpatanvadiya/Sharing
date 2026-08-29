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
  idle_timeout: 30,
  connect_timeout: 15,
  ssl: sslSetting(env.DATABASE_URL),
  onnotice: () => {},
});

export const db = drizzle(client, { schema });
export const sqlClient = client;
export { schema };

export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
