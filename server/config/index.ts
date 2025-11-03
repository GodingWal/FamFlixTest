import { z } from "zod";

const configSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, "Database URL is required"),
  
  // JWT Configuration
  JWT_SECRET: z.string().min(32, "JWT secret must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT refresh secret must be at least 32 characters"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  
  // Session Configuration
  SESSION_SECRET: z.string().min(32, "Session secret must be at least 32 characters"),
  SESSION_TIMEOUT: z.string().default("30m"),
  COOKIE_SECURE: z.string().transform(val => val === "true").default("false"),
  COOKIE_SAME_SITE: z.enum(["strict", "lax", "none"]).default("lax"),
  
  // API Keys
  OPENAI_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_TTS_MODEL: z.string().optional(),
  ELEVENLABS_OPT_STABILITY: z
    .string()
    .optional()
    .transform((val) => (val === undefined || val === "" ? undefined : Number(val))),
  ELEVENLABS_OPT_SIMILARITY_BOOST: z
    .string()
    .optional()
    .transform((val) => (val === undefined || val === "" ? undefined : Number(val))),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default("900000"),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default("100"),
  AUTH_RATE_LIMIT_MAX: z.string().transform(Number).default("5"),

  // Redis
  REDIS_URL: z.string().optional(),

  // Monitoring
  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  
  // Application
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().transform(Number).default("5000"),
  CLIENT_URL: z.string().default("http://localhost:5000"),
  FEATURE_STORY_MODE: z.string().transform((val) => val === "true").default("false"),
  TTS_PROVIDER: z
    .enum(["CHATTERBOX", "ELEVENLABS", "PLAYHT", "AZURE", "COQUI", "MOCK"] as const)
    .default("CHATTERBOX"),
  STORY_AUDIO_PREFIX: z.string().default("stories"),

  // Chatterbox (Resemble AI) configuration
  CHATTERBOX_SCRIPT_PATH: z.string().default("scripts/chatterbox_tts.py"),
  PYTHON_BIN: z.string().default("python3"),
  CHATTERBOX_DEVICE: z.string().default("cpu"), // cpu or cuda
  CHATTERBOX_MULTILINGUAL: z.string().transform((val) => val === "true").default("false"),
  CHATTERBOX_LANGUAGE_ID: z.string().optional(),
  CHATTERBOX_EXAGGERATION: z
    .string()
    .optional()
    .transform((val) => (val === undefined || val === "" ? undefined : Number(val))),
  CHATTERBOX_CFG_WEIGHT: z
    .string()
    .optional()
    .transform((val) => (val === undefined || val === "" ? undefined : Number(val))),

  // File Upload
  MAX_FILE_SIZE: z.string().transform(Number).default("52428800"), // 50MB
  UPLOAD_DIR: z.string().default("uploads"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().transform((val) => val === "true").default("false"),

  // Email
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  FROM_EMAIL: z.string().optional(),
  MARKETING_LEAD_EMAIL: z.string().optional(),

  // Billing / Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STORY_WORKER_CONCURRENCY: z
    .string()
    .optional()
    .transform((val) => (val === undefined || val === "" ? undefined : Number(val))),
});

// Load and validate environment variables
function loadConfig(): Config {
  try {
    const config = configSchema.parse(process.env);
    if (config.FEATURE_STORY_MODE && !config.REDIS_URL) {
      console.warn("[config] FEATURE_STORY_MODE enabled but REDIS_URL is not set. Story jobs require Redis.");
    }
    if (config.FEATURE_STORY_MODE && !config.S3_BUCKET) {
      console.warn("[config] FEATURE_STORY_MODE enabled but S3_BUCKET is not configured. Audio uploads will fail until storage is set up.");
    }
    return config;
  } catch (error) {
    console.error("Configuration validation failed:");
    if (error instanceof z.ZodError) {
      error.errors.forEach(err => {
        console.error(`${err.path.join('.')}: ${err.message}`);
      });
    }
    process.exit(1);
    throw new Error("Configuration validation failed");
  }
}

export const config = loadConfig();
export type Config = z.infer<typeof configSchema>;
