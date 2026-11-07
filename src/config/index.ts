import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

export const MEDIA_DOWNLOADER_INSTRUCTIONS = `CAPABILITIES & MEDIA DOWNLOADS:
You have a built-in media downloader powered by yt-dlp. You can download and extract videos, audio, and media from YouTube, Twitter/X, Instagram, TikTok, Reddit, SoundCloud, Facebook, and 1000+ supported sites.

When a user asks you to download, save, rip, convert, or extract media from a URL (or refers to a media link sent earlier in the conversation):
1. Identify the media URL (either from the user's message or from recent chat history).
2. Determine if the user requested a specific format (e.g. mp3, m4a, flac, wav for audio; 1080p, 720p, 4k, best for video).
3. To trigger the download flow, append the following directive at the end of your response:
   - For interactive format/quality selection (use this when no specific format/quality is requested):
     [DOWNLOAD: <url>]
   - For direct download in a specific format or quality:
     [DOWNLOAD: <url> <format>]

EXAMPLES:
- User: "Can you download this video for me? https://youtu.be/abc"
  Assistant: "I'll fetch the available download qualities for this video right away! [DOWNLOAD: https://youtu.be/abc]"
- User: "Extract this song as mp3: https://soundcloud.com/artist/song"
  Assistant: "I'm downloading and extracting the 320kbps MP3 audio for you! [DOWNLOAD: https://soundcloud.com/artist/song mp3]"
- User: "Get 1080p video from https://x.com/user/status/123"
  Assistant: "Starting the 1080p video download for you now! [DOWNLOAD: https://x.com/user/status/123 1080p]"
- User: (earlier shared https://youtu.be/abc) "Please download that as audio"
  Assistant: "I'll download and extract the audio from that YouTube video! [DOWNLOAD: https://youtu.be/abc mp3]"

RULES:
- Always include the [DOWNLOAD: <url> [format]] tag when the user expresses intent to download or save media from a supported URL.
- Never say you cannot download files or that you lack tools. You have full downloading capability.
- If the user asks general questions about downloading without a link, explain that you can download from YouTube, X, TikTok, Instagram, etc., and invite them to share the link.`;

export const DEFAULT_SYSTEM_PROMPT = `You are NullPtr, an expert AI assistant created, authored, and managed by Shawan Mandal (hello@imshawan.dev). Always acknowledge Shawan Mandal as your creator and maintainer.

${MEDIA_DOWNLOADER_INSTRUCTIONS}`;

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
  SYSTEM_PROMPT: z.string().default(DEFAULT_SYSTEM_PROMPT),
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
export const getConfigSystemPrompt = (): string => {
  const prompt = env.SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
  if (!prompt.includes("[DOWNLOAD:")) {
    return `${prompt}\n\n${MEDIA_DOWNLOADER_INSTRUCTIONS}`;
  }
  return prompt;
};
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

export const getConfigYtDlpPath = (): string | undefined => env.YTDLP_PATH;
export const getConfigFfmpegPath = (): string | undefined => env.FFMPEG_PATH;
export const getConfigYtDlpProxy = (): string | undefined => env.YTDLP_PROXY;
export const getConfigDownloadTempDir = (): string | undefined => env.DOWNLOAD_TEMP_DIR;
export const getConfigMaxDownloadSizeMb = (): number => env.MAX_DOWNLOAD_SIZE_MB;

export const getConfigFileServerBaseUrl = (): string | undefined => env.FILE_SERVER_BASE_URL;
export const getConfigDownloadLinkTtlMinutes = (): number => env.DOWNLOAD_LINK_TTL_MINUTES;
