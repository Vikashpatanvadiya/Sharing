import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` only reads the schema file, so a placeholder keeps it
// usable without a database. `push`, `migrate` and `studio` still need a real
// DATABASE_URL and will fail loudly without one.
const url = process.env.DATABASE_URL ?? "postgresql://localhost:5432/shared_album";

export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
