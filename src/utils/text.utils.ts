/**
 * Splits text into chunks that do not exceed maxLength,
 * attempting to preserve newline and paragraph boundaries.
 */
export function splitMessageText(text: string, maxLength: number = 4000): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      splitIdx = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

/**
 * Formats a duration in seconds into a human-readable string (e.g. 1h 24m 5s).
 */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

/**
 * Validates if a URL is acceptable for Telegram InlineKeyboardButton 'url' field.
 * Telegram strictly rejects localhost, loopback, private RFC1918 IPs, and non-http(s) protocols with BUTTON_URL_INVALID.
 */
export function isTelegramButtonUrl(urlStr: string): boolean {
  if (!urlStr) return false;
  try {
    const parsed = new URL(urlStr);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local") ||
      host.startsWith("192.168.") ||
      host.startsWith("10.") ||
      host.startsWith("172.16.") ||
      host.startsWith("172.17.") ||
      host.startsWith("172.18.") ||
      host.startsWith("172.19.") ||
      host.startsWith("172.20.") ||
      host.startsWith("172.21.") ||
      host.startsWith("172.22.") ||
      host.startsWith("172.23.") ||
      host.startsWith("172.24.") ||
      host.startsWith("172.25.") ||
      host.startsWith("172.26.") ||
      host.startsWith("172.27.") ||
      host.startsWith("172.28.") ||
      host.startsWith("172.29.") ||
      host.startsWith("172.30.") ||
      host.startsWith("172.31.")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Escapes characters for safe inclusion in HTML.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface DownloadDirective {
  url: string;
  format?: string;
}

/**
 * Parses [DOWNLOAD: <url> [format]] or JSON download actions emitted by the LLM.
 */
export function parseDownloadDirective(text: string): DownloadDirective | null {
  if (!text) return null;

  // 1. JSON structure: [DOWNLOAD: {"url": "...", "format": "..."}]
  const jsonMatch = text.match(/\[(?:ACTION:)?\s*DOWNLOAD:?\s*(\{[\s\S]*?\})\]/i);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      if (data && typeof data.url === "string" && data.url.startsWith("http")) {
        return {
          url: data.url.trim().replace(/[.,;!?)]+$/, ""),
          format: typeof data.format === "string" ? data.format.trim().toLowerCase() : undefined,
        };
      }
    } catch {
      // Fall through to regex parsing
    }
  }

  // 2. Standard tag: [DOWNLOAD: <url> [format]] or [DOWNLOAD <url> [format]]
  const tagMatch = text.match(
    /\[(?:ACTION:)?\s*DOWNLOAD:?\s*(?:\[[^\]]*\]\()?([^\s\])]+)\)?(?:\s+([a-zA-Z0-9]+))?\s*\]/i
  );
  if (tagMatch) {
    let url = tagMatch[1].trim().replace(/[.,;!?)]+$/, "");
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const format = tagMatch[2]?.trim().toLowerCase();
      return { url, format };
    }
  }

  // 3. Command style: /download <url> [format]
  const cmdMatch = text.match(/\/(?:download|dl)\s+(https?:\/\/[^\s]+)(?:\s+([a-zA-Z0-9]+))?/i);
  if (cmdMatch) {
    let url = cmdMatch[1].trim().replace(/[.,;!?)]+$/, "");
    const format = cmdMatch[2]?.trim().toLowerCase();
    return { url, format };
  }

  return null;
}

/**
 * Strips internal download directives from text so the Telegram user only sees the conversational response.
 */
export function cleanDownloadDirective(text: string): string {
  if (!text) return "";
  return text
    .replace(/\[(?:ACTION:)?\s*DOWNLOAD:?[\s\S]*?\]/gi, "")
    .replace(/\[(?:ACTION:)?\s*D(?:OWNLOAD)?[:\s][^\]]*$/gi, "")
    .replace(/\/(?:download|dl)\s+https?:\/\/[^\s]+(?:\s+[a-zA-Z0-9]+)?/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Detects whether a user message expresses intent to download media, and extracts any specified format.
 */
export function detectDownloadIntent(text: string): { hasIntent: boolean; format?: string } {
  if (!text) return { hasIntent: false };

  // Explicit negations: "don't download", "never download", "stop download", "cancel download"
  if (/\b(?:don't|do not|never|stop|cancel)\s+(?:download|dl|save|get)\b/i.test(text)) {
    return { hasIntent: false };
  }

  // Action verbs expressing download intent
  const downloadPattern = /\b(?:download|dl|save|rip|extract|convert|grab)\b/i;
  const hasIntent = downloadPattern.test(text);
  if (!hasIntent) return { hasIntent: false };

  // Detect requested formats
  const audioMatch = text.match(/\b(mp3|m4a|wav|flac|aac|opus|audio|song|music)\b/i);
  const videoMatch = text.match(/\b(8k|4k|2160p|1440p|1080p|720p|480p|360p|240p|144p|mp4|mkv|webm)\b/i);

  let format: string | undefined = undefined;
  if (audioMatch) {
    format = ["audio", "song", "music"].includes(audioMatch[1].toLowerCase())
      ? "mp3"
      : audioMatch[1].toLowerCase();
  } else if (videoMatch) {
    format = videoMatch[1].toLowerCase();
  }

  return { hasIntent: true, format };
}

