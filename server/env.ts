import "dotenv/config";
import { z } from "zod";

/**
 * Every secret the app needs, validated once at boot. Failing loudly here beats
 * discovering a missing Cloudinary secret in the middle of an upload.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  CLOUDINARY_CLOUD_NAME: z.string().min(1, "CLOUDINARY_CLOUD_NAME is required"),
  CLOUDINARY_API_KEY: z.string().min(1, "CLOUDINARY_API_KEY is required"),
  CLOUDINARY_API_SECRET: z.string().min(1, "CLOUDINARY_API_SECRET is required"),
  CLOUDINARY_FOLDER: z.string().min(1).default("shared-albums"),
  /** Advanced: override the Cloudinary API host (regional endpoint, or a mock). */
  CLOUDINARY_API_BASE: z.string().url().optional(),

  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters — generate a random one"),

  MAX_IMAGE_SIZE_MB: z.coerce.number().positive().default(100),
  MAX_VIDEO_SIZE_MB: z.coerce.number().positive().default(2000),

  PUBLIC_ORIGIN: z.string().default("http://localhost:3000"),
  DOWNLOAD_TMP_DIR: z.string().default("./tmp/downloads"),
  DOWNLOAD_TTL_MINUTES: z.coerce.number().positive().default(30),
});

/**
 * The values shipped in .env.example. Copying the file and running without
 * editing it is the single most common setup mistake, and the errors it
 * produces are confusing ("role \"user\" does not exist"), so catch it here.
 */
const PLACEHOLDERS: Record<string, string> = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/shared_album",
  CLOUDINARY_CLOUD_NAME: "your-cloud-name",
  CLOUDINARY_API_KEY: "123456789012345",
  CLOUDINARY_API_SECRET: "your-api-secret",
  SESSION_SECRET: "replace-me-with-a-long-random-string",
};

const untouched = Object.entries(PLACEHOLDERS)
  .filter(([key, placeholder]) => process.env[key]?.trim() === placeholder)
  .map(([key]) => key);

if (untouched.length) {
  // eslint-disable-next-line no-console
  console.error(
    `\nYour .env still holds the example values for:\n` +
      untouched.map((key) => `  - ${key}`).join("\n") +
      `\n\nEdit the .env file in the project root (not .env.example) and put your real values there.` +
      `\nGenerate a session secret with:` +
      `\n  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"\n`,
  );
  process.exit(1);
}

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  // eslint-disable-next-line no-console
  console.error(`\nInvalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill in the values.\n`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === "production",
  isDevelopment: raw.NODE_ENV === "development",
  /** Allowed origins for CSRF checks, derived from PUBLIC_ORIGIN. */
  allowedOrigins: raw.PUBLIC_ORIGIN.split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean),
  maxImageSizeBytes: Math.round(raw.MAX_IMAGE_SIZE_MB * 1024 * 1024),
  maxVideoSizeBytes: Math.round(raw.MAX_VIDEO_SIZE_MB * 1024 * 1024),
  downloadTtlMs: raw.DOWNLOAD_TTL_MINUTES * 60 * 1000,
};

export type Env = typeof env;
