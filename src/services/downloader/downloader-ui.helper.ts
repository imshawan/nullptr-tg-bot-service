import { InlineKeyboardMarkup } from "@/domain/telegram/telegram.types";
import { MediaInfo, VideoResolutionOption } from "@/domain/downloader/downloader.types";
import { formatDuration } from "@/utils/text.utils";

export interface PendingDownloadSession {
  token: string;
  url: string;
  title: string;
  uploader?: string;
  duration?: number;
  createdAt: number;
  availableVideoQualities: VideoResolutionOption[];
  selectedVideoFormat: "mp4" | "mkv" | "webm";
  selectedAudioFormat: "mp3" | "m4a" | "flac" | "wav" | "opus";
}

// In-memory cache for active download sessions: token -> session
export const pendingDownloadSessions = new Map<string, PendingDownloadSession>();

// Cleanup stale sessions older than 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingDownloadSessions.entries()) {
    if (now - val.createdAt > 30 * 60 * 1000) {
      pendingDownloadSessions.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();

export function createDownloadSession(info: MediaInfo): PendingDownloadSession {
  const token = Math.random().toString(36).substring(2, 10);
  const session: PendingDownloadSession = {
    token,
    url: info.url,
    title: info.title,
    uploader: info.uploader,
    duration: info.duration,
    createdAt: Date.now(),
    availableVideoQualities: info.availableVideoQualities || [
      { quality: "1080p", label: "1080p FHD" },
      { quality: "720p", label: "720p HD" },
      { quality: "480p", label: "480p SD" },
      { quality: "360p", label: "360p" },
    ],
    selectedVideoFormat: "mp4",
    selectedAudioFormat: "mp3",
  };

  pendingDownloadSessions.set(token, session);
  return session;
}

export function buildMainMenu(session: PendingDownloadSession): { text: string; replyMarkup: InlineKeyboardMarkup } {
  const durationStr = session.duration ? ` · ⏱️ ${formatDuration(session.duration)}` : "";
  const uploaderStr = session.uploader ? ` · 👤 ${session.uploader}` : "";

  const text = [
    `🎬 *${session.title}*`,
    `${durationStr}${uploaderStr}`,
    "",
    "Choose a quick download or explore all available options:",
  ].join("\n");

  const replyMarkup: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: "⚡ Quick Best (MP4)", callback_data: `dl:q:v:${session.token}` },
        { text: "⚡ Quick MP3 (320k)", callback_data: `dl:q:a:${session.token}` },
      ],
      [
        { text: "🎬 All Video Qualities", callback_data: `dl:v_menu:${session.token}` },
      ],
      [
        { text: "🎵 All Audio Formats & Bitrates", callback_data: `dl:a_menu:${session.token}` },
      ],
      [
        { text: "❌ Cancel", callback_data: `dl:cancel:none:${session.token}` },
      ],
    ],
  };

  return { text, replyMarkup };
}

export function buildVideoMenu(session: PendingDownloadSession): { text: string; replyMarkup: InlineKeyboardMarkup } {
  const text = [
    `🎬 *${session.title}*`,
    `Select video resolution (*Container: ${session.selectedVideoFormat.toUpperCase()}*):`,
    "",
    "💡 _Resolutions marked with ⚠️ exceed Telegram's 50 MB bot limit (stream/download link will be provided)._",
  ].join("\n");

  const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];

  // Top action: Best Available (mirroring tubesnag-desktop default)
  keyboardRows.push([
    {
      text: "🌟 Best Available (Auto)",
      callback_data: `dl:v_run:${session.selectedVideoFormat}:best:${session.token}`,
    },
  ]);

  // Specific resolutions in pairs of 2
  const resButtons: Array<{ text: string; callback_data: string }> = [];

  for (const vq of session.availableVideoQualities) {
    if (vq.quality === "best") continue;
    let sizeBadge = "";
    if (vq.approxSizeBytes) {
      const sizeMb = Math.round(vq.approxSizeBytes / (1024 * 1024));
      if (vq.approxSizeBytes > 50 * 1024 * 1024) {
        sizeBadge = ` (⚠️ ~${sizeMb}MB)`;
      } else {
        sizeBadge = ` (~${sizeMb}MB)`;
      }
    }

    resButtons.push({
      text: `${vq.label}${sizeBadge}`,
      callback_data: `dl:v_run:${session.selectedVideoFormat}:${vq.quality}:${session.token}`,
    });
  }

  for (let i = 0; i < resButtons.length; i += 2) {
    keyboardRows.push(resButtons.slice(i, i + 2));
  }

  // Format selection row (MP4, MKV, WEBM)
  const formats: Array<"mp4" | "mkv" | "webm"> = ["mp4", "mkv", "webm"];
  const formatButtons = formats.map((fmt) => ({
    text: fmt === session.selectedVideoFormat ? `• ${fmt.toUpperCase()} •` : fmt.toUpperCase(),
    callback_data: `dl:v_fmt:${fmt}:${session.token}`,
  }));
  keyboardRows.push(formatButtons);

  // Navigation row
  keyboardRows.push([
    { text: "⬅️ Back to Menu", callback_data: `dl:back:${session.token}` },
    { text: "❌ Cancel", callback_data: `dl:cancel:none:${session.token}` },
  ]);

  return { text, replyMarkup: { inline_keyboard: keyboardRows } };
}

export function buildAudioMenu(session: PendingDownloadSession): { text: string; replyMarkup: InlineKeyboardMarkup } {
  const currentFormat = session.selectedAudioFormat.toUpperCase();
  const text = [
    `🎵 *${session.title}*`,
    `Selected Format: *${currentFormat}*`,
    "",
    "Choose format & desired audio quality:",
  ].join("\n");

  const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];

  // Format selection rows (Row 1: tubesnag-desktop core formats; Row 2: extended formats)
  const coreFormats: Array<"mp3" | "m4a" | "wav"> = ["mp3", "m4a", "wav"];
  const extFormats: Array<"flac" | "opus"> = ["flac", "opus"];

  keyboardRows.push(
    coreFormats.map((fmt) => ({
      text: fmt === session.selectedAudioFormat ? `• ${fmt.toUpperCase()} •` : fmt.toUpperCase(),
      callback_data: `dl:a_fmt:${fmt}:${session.token}`,
    }))
  );
  keyboardRows.push(
    extFormats.map((fmt) => ({
      text: fmt === session.selectedAudioFormat ? `• ${fmt.toUpperCase()} •` : fmt.toUpperCase(),
      callback_data: `dl:a_fmt:${fmt}:${session.token}`,
    }))
  );

  // Quality / Bitrate selection
  if (session.selectedAudioFormat === "flac" || session.selectedAudioFormat === "wav") {
    // Lossless / uncompressed
    keyboardRows.push([
      {
        text: `🎧 Download Lossless ${currentFormat}`,
        callback_data: `dl:a_run:${session.selectedAudioFormat}:320:${session.token}`,
      },
    ]);
  } else {
    // Bitrate selection
    keyboardRows.push([
      { text: "💎 320 kbps (Best)", callback_data: `dl:a_run:${session.selectedAudioFormat}:320:${session.token}` },
      { text: "🎶 256 kbps (High)", callback_data: `dl:a_run:${session.selectedAudioFormat}:256:${session.token}` },
    ]);
    keyboardRows.push([
      { text: "📻 192 kbps (Standard)", callback_data: `dl:a_run:${session.selectedAudioFormat}:192:${session.token}` },
      { text: "📁 128 kbps (Compact)", callback_data: `dl:a_run:${session.selectedAudioFormat}:128:${session.token}` },
    ]);
  }

  // Navigation row
  keyboardRows.push([
    { text: "⬅️ Back to Menu", callback_data: `dl:back:${session.token}` },
    { text: "❌ Cancel", callback_data: `dl:cancel:none:${session.token}` },
  ]);

  return { text, replyMarkup: { inline_keyboard: keyboardRows } };
}
