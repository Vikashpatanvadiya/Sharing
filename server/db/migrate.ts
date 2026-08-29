import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../env.js";
import { sslSetting } from "./ssl.js";
import { logger } from "../lib/logger.js";

/** Applies everything in ./drizzle to the configured database, then exits. */
async function main() {
  const client = postgres(env.DATABASE_URL, {
    max: 1,
    ssl: sslSetting(env.DATABASE_URL),
    // "table will create implicit index" notices are expected and noisy.
    onnotice: () => {},
  });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    logger.info("migrations applied");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error) => {
  logger.error("migration failed", { error });
  process.exit(1);
});
