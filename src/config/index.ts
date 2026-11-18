import dotenv from "dotenv";
import { z } from "zod";
import { ILogger } from "@/core/logger/logger.interface";
import {
  DEFAULT_BOT_NAME,
  DEFAULT_SYSTEM_PROMPT,
  USER_IDENTITY_INSTRUCTIONS,
  MATURE_TOPIC_INSTRUCTIONS,
  MEDIA_DOWNLOADER_INSTRUCTIONS,
  buildFullSystemPrompt,
} from "@/prompts";

dotenv.config();

export {
  DEFAULT_BOT_NAME,
  DEFAULT_SYSTEM_PROMPT,
  USER_IDENTITY_INSTRUCTIONS,
  MATURE_TOPIC_INSTRUCTIONS,
  MEDIA_DOWNLOADER_INSTRUCTIONS,
};

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("3000").transform((val) => parseInt(val, 10)),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  BOT_NAME: z.string().default(DEFAULT_BOT_NAME),

  // Telegram configuration
  TELEGRAM_TOKEN: z
    .string({
      required_error: "TELEGRAM_TOKEN is required. Obtain one from @BotFather on Telegram.",
    })
    .min(1, "TELEGRAM_TOKEN cannot be empty"),
  ALLOWED_USER_ID: z.string().optional(),
  ALLOWED_USER_IDS: z.string().optional(),
  STREAM_EDIT_INTERVAL_MS: z.string().default("2000").transform((val) => parseInt(val, 10)),
  USER_TIMEZONE: z.string().default("Asia/Kolkata"),

  // LLM / Ollama configuration
  OLLAMA_HOST: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_BASE_URL: z.string().optional(),
  OLLAMA_MODEL: z.string().default("qwen2.5-coder:latest"),
  OLLAMA_AUTH: z.string().optional(),
  OLLAMA_NUM_CTX: z.string().default("2048").transform((val) => parseInt(val, 10)),
  OLLAMA_TEMPERATURE: z.string().default("0.65").transform((val) => parseFloat(val)),
  ALLOW_MATURE_CONTENT: z
    .string()
    .default("true")
    .transform((val) => val.toLowerCase() === "true" || val === "1"),
  SYSTEM_PROMPT: z.string().default(DEFAULT_SYSTEM_PROMPT),
  MAX_HISTORY_MESSAGES: z.string().default("20").transform((val) => parseInt(val, 10)),
  LLM_QUERY_TIMEOUT_MS: z.string().default("600000").transform((val) => parseInt(val, 10)),

  // Media Downloader (yt-dlp) configuration
  YTDLP_PATH: z.string().optional(),
  FFMPEG_PATH: z.string().optional(),
  YTDLP_PROXY: z.string().optional(),
  DOWNLOAD_TEMP_DIR: z.string().optional(),
  MAX_DOWNLOAD_SIZE_MB: z.string().default("50").transform((val) => parseInt(val, 10)),

  // File Server configuration (for direct downloads > 50 MB)
  FILE_SERVER_BASE_URL: z.string().optional(),
  DOWNLOAD_LINK_TTL_MINUTES: z.string().default("120").transform((val) => parseInt(val, 10)),
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
 * Global constant representing the bot's name across logs, system prompts, commands, and views.
 */
export const BOT_NAME: string = env.BOT_NAME;

/**
 * Generic config getter by key.
 */
export function getConfig<K extends keyof EnvConfig>(key: K): EnvConfig[K] {
  return env[key];
}

/**
 * Individual getter functions matching getConfig<EnvKey>() pattern.
 */
export const getConfigBotName = (): string => BOT_NAME;
export const getConfigNodeEnv = (): "development" | "production" | "test" => env.NODE_ENV;
export const getConfigPort = (): number => env.PORT;
export const getConfigLogLevel = (): "debug" | "info" | "warn" | "error" => env.LOG_LEVEL;

export const getConfigTelegramToken = (): string => env.TELEGRAM_TOKEN;
export const getConfigStreamEditIntervalMs = (): number => env.STREAM_EDIT_INTERVAL_MS;
export const getConfigUserTimezone = (): string => env.USER_TIMEZONE;

export const getConfigAllowedUserIds = (): Set<string> => {
  const rawAllowed = [env.ALLOWED_USER_IDS, env.ALLOWED_USER_ID].filter(Boolean).join(",");
  return new Set<string>(
    rawAllowed
      .split(",")
      .map((id) => id.trim().toLowerCase().replace(/^@/, ""))
      .filter((id) => id.length > 0)
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
export const getConfigOllamaNumCtx = (): number => env.OLLAMA_NUM_CTX;
export const getConfigOllamaTemperature = (): number => env.OLLAMA_TEMPERATURE;
export const getConfigAllowMatureContent = (): boolean => env.ALLOW_MATURE_CONTENT;
export const getConfigSystemPrompt = (): string =>
  buildFullSystemPrompt(env.SYSTEM_PROMPT, env.BOT_NAME, env.ALLOW_MATURE_CONTENT);
export const getConfigMaxHistoryMessages = (): number => env.MAX_HISTORY_MESSAGES;
export const getConfigLlmQueryTimeoutMs = (): number => env.LLM_QUERY_TIMEOUT_MS;

export const getConfigYtDlpPath = (): string | undefined => env.YTDLP_PATH;
export const getConfigFfmpegPath = (): string | undefined => env.FFMPEG_PATH;
export const getConfigYtDlpProxy = (): string | undefined => env.YTDLP_PROXY;
export const getConfigDownloadTempDir = (): string | undefined => env.DOWNLOAD_TEMP_DIR;
export const getConfigMaxDownloadSizeMb = (): number => env.MAX_DOWNLOAD_SIZE_MB;

export const getConfigFileServerBaseUrl = (): string | undefined => env.FILE_SERVER_BASE_URL;
export const getConfigDownloadLinkTtlMinutes = (): number => env.DOWNLOAD_LINK_TTL_MINUTES;

/**
 * Safely masks sensitive credential values for logs.
 */
function maskSecret(val?: string): string {
  if (!val) return "[none]";
  if (val.length <= 8) return "***";
  return `${val.slice(0, 4)}...${val.slice(-4)}`;
}

/**
 * Logs a structured, security-safe summary of all active environment configurations on startup.
 */
export function logConfiguration(logger: ILogger): void {
  const cfgLogger = logger.child("Config");
  const allowedUsers = getConfigAllowedUserIds();
  const allowedUserSummary =
    allowedUsers.size > 0
      ? `${allowedUsers.size} user(s) (${Array.from(allowedUsers).join(", ")})`
      : "unrestricted (all users allowed)";
  const systemPromptStatus =
    env.SYSTEM_PROMPT === DEFAULT_SYSTEM_PROMPT
      ? "default"
      : `custom (${env.SYSTEM_PROMPT.length} chars)`;

  cfgLogger.info("⚙️ Active Environment Configuration (26 params):");
  cfgLogger.info(
    `• System & Runtime: BOT_NAME="${BOT_NAME}", NODE_ENV="${env.NODE_ENV}", LOG_LEVEL="${env.LOG_LEVEL}", USER_TIMEZONE="${env.USER_TIMEZONE}"`
  );
  cfgLogger.info(
    `• Telegram API: TELEGRAM_TOKEN="${maskSecret(env.TELEGRAM_TOKEN)}", STREAM_EDIT_INTERVAL_MS=${env.STREAM_EDIT_INTERVAL_MS}ms, ALLOWED_USER_IDS=${allowedUserSummary}`
  );
  cfgLogger.info(
    `• LLM Endpoint: OLLAMA_HOST="${getConfigOllamaHost()}"${env.OLLAMA_BASE_URL ? ` (via OLLAMA_BASE_URL)` : ""}, OLLAMA_MODEL="${env.OLLAMA_MODEL}", OLLAMA_AUTH=${env.OLLAMA_AUTH ? "[configured]" : "[none]"}`
  );
  cfgLogger.info(
    `• LLM Hyperparameters: OLLAMA_NUM_CTX=${env.OLLAMA_NUM_CTX}, OLLAMA_TEMPERATURE=${env.OLLAMA_TEMPERATURE}, ALLOW_MATURE_CONTENT=${env.ALLOW_MATURE_CONTENT}, MAX_HISTORY_MESSAGES=${env.MAX_HISTORY_MESSAGES}, LLM_QUERY_TIMEOUT_MS=${env.LLM_QUERY_TIMEOUT_MS}ms, SYSTEM_PROMPT=[${systemPromptStatus}]`
  );
  cfgLogger.info(
    `• HTTP File Server: PORT=${env.PORT}, FILE_SERVER_BASE_URL="${env.FILE_SERVER_BASE_URL || "[auto-detect]"}", DOWNLOAD_LINK_TTL_MINUTES=${env.DOWNLOAD_LINK_TTL_MINUTES}m`
  );
  cfgLogger.info(
    `• Media Downloader (yt-dlp): MAX_DOWNLOAD_SIZE_MB=${env.MAX_DOWNLOAD_SIZE_MB}MB, YTDLP_PATH="${env.YTDLP_PATH || "[auto-detect]"}", FFMPEG_PATH="${env.FFMPEG_PATH || "[auto-detect]"}", YTDLP_PROXY="${env.YTDLP_PROXY || "[none]"}", DOWNLOAD_TEMP_DIR="${env.DOWNLOAD_TEMP_DIR || "[system-temp]"}"`
  );
}
