import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("3000").transform((val) => parseInt(val, 10)),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Telegram configuration
  TELEGRAM_TOKEN: z
    .string({
      required_error: "TELEGRAM_TOKEN is required. Obtain one from @BotFather on Telegram.",
    })
    .min(1, "TELEGRAM_TOKEN cannot be empty"),
  ALLOWED_USER_ID: z.string().optional(),
  ALLOWED_USER_IDS: z.string().optional(),
  STREAM_EDIT_INTERVAL_MS: z.string().default("1200").transform((val) => parseInt(val, 10)),

  // LLM / Ollama configuration
  OLLAMA_HOST: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_BASE_URL: z.string().optional(),
  OLLAMA_MODEL: z.string().default("qwen2.5-coder:latest"),
  OLLAMA_AUTH: z.string().optional(),
  SYSTEM_PROMPT: z
    .string()
    .default(
      "You are nullptr (NullPointer Bot), an expert AI assistant created, authored, and managed by Shawan Mandal (hello@imshawan.dev). Always acknowledge Shawan Mandal as your creator and maintainer."
    ),
  MAX_HISTORY_MESSAGES: z.string().default("20").transform((val) => parseInt(val, 10)),
  LLM_QUERY_TIMEOUT_MS: z.string().default("600000").transform((val) => parseInt(val, 10)),

  // Optional multi-provider API keys
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-3-5-sonnet-20241022"),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  GEMINI_MODEL: z.string().default("gemini-1.5-pro-latest"),

  // Optional cache / storage
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.string().default("6379").transform((val) => parseInt(val, 10)),
});

export type EnvConfig = z.infer<typeof envSchema>;

let parsedEnv: EnvConfig;
try {
  parsedEnv = envSchema.parse(process.env);
} catch (err) {
  if (err instanceof z.ZodError) {
    const formatted = err.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    console.error(`❌ Configuration Error:\n${formatted}\n`);
  }
  throw err;
}

export const env: EnvConfig = parsedEnv;

/**
 * Generic config getter by key.
 */
export function getConfig<K extends keyof EnvConfig>(key: K): EnvConfig[K] {
  return env[key];
}

/**
 * Individual getter functions matching getConfig<EnvKey>() pattern.
 */
export const getConfigNodeEnv = (): "development" | "production" | "test" => env.NODE_ENV;
export const getConfigPort = (): number => env.PORT;
export const getConfigLogLevel = (): "debug" | "info" | "warn" | "error" => env.LOG_LEVEL;

export const getConfigTelegramToken = (): string => env.TELEGRAM_TOKEN;
export const getConfigStreamEditIntervalMs = (): number => env.STREAM_EDIT_INTERVAL_MS;

export const getConfigAllowedUserIds = (): Set<number> => {
  const rawAllowed = [env.ALLOWED_USER_IDS, env.ALLOWED_USER_ID].filter(Boolean).join(",");
  return new Set<number>(
    rawAllowed
      .split(",")
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id) && id > 0)
  );
};

export const getConfigOllamaHost = (): string => {
  let host = env.OLLAMA_BASE_URL || env.OLLAMA_HOST;
  host = host.replace(/\/+$/, "");
  if (host.endsWith("/v1")) {
    host = host.slice(0, -3);
  }
  return host;
};
export const getConfigOllamaModel = (): string => env.OLLAMA_MODEL;
export const getConfigOllamaAuth = (): string | undefined => env.OLLAMA_AUTH;
export const getConfigSystemPrompt = (): string | undefined => env.SYSTEM_PROMPT;
export const getConfigMaxHistoryMessages = (): number => env.MAX_HISTORY_MESSAGES;
export const getConfigLlmQueryTimeoutMs = (): number => env.LLM_QUERY_TIMEOUT_MS;

export const getConfigAnthropicApiKey = (): string | undefined => env.ANTHROPIC_API_KEY;
export const getConfigOpenaiApiKey = (): string | undefined => env.OPENAI_API_KEY;
export const getConfigGeminiApiKey = (): string | undefined => env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
export const getConfigAnthropicModel = (): string => env.ANTHROPIC_MODEL;
export const getConfigOpenaiModel = (): string => env.OPENAI_MODEL;
export const getConfigGeminiModel = (): string => env.GEMINI_MODEL;

export const getConfigRedisHost = (): string => env.REDIS_HOST;
export const getConfigRedisPort = (): number => env.REDIS_PORT;
