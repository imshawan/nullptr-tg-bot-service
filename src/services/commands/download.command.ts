import fs from "node:fs/promises";
import { ICommandHandler, CommandContext } from "@/services/commands/command.interface";
import { MediaFormat, MediaQuality, AudioBitrate } from "@/domain/downloader/downloader.types";
import { InlineKeyboardMarkup } from "@/domain/telegram/telegram.types";
import { isTelegramButtonUrl } from "@/utils/text.utils";
import {
  createDownloadSession,
  buildMainMenu,
  pendingDownloadSessions,
} from "@/services/downloader/downloader-ui.helper";

// Export for backward compatibility across modules
export const pendingDownloadUrls = pendingDownloadSessions;

export class DownloadCommand implements ICommandHandler {
  public readonly command = "download";
  public readonly description = "Download video or audio from YouTube, X, TikTok, etc.";
  public readonly aliases = ["dl"];

  public async execute(ctx: CommandContext): Promise<void> {
    const rawTarget = ctx.args[0];

    if (!rawTarget) {
      const msg = [
        `📥 *nullptr (NullPointer Bot) Downloader*`,
        "",
        "Usage: `/download <url> [format]` (or `/dl <url>`)",
        "",
        "• *Audio formats:* `mp3`, `m4a`, `flac`, `wav`, `opus`, `aac`",
        "• *Video qualities:* `best`, `8k`, `4k`, `2160p`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`",
        "",
        "💡 _Tip: You can also simply paste any video link in chat to open the interactive format & quality selector!_",
      ].join("\n");

      await ctx.telegram.sendMessage({
        chat_id: ctx.chatId,
        text: msg,
        parse_mode: "Markdown",
      });
      return;
    }

    const url = ctx.downloader.extractUrl(rawTarget);
    if (!url || !ctx.downloader.isSupportedUrl(url)) {
      await ctx.telegram.sendMessage({
        chat_id: ctx.chatId,
        text: "⚠️ Please provide a valid HTTP/HTTPS media link (e.g. YouTube, Twitter/X, Instagram, TikTok, Soundcloud).",
      });
      return;
    }

    const formatArg = ctx.args[1]?.toLowerCase();

    // If explicit format requested (e.g. /dl <url> mp3 or /dl <url> 1080p)
    if (formatArg) {
      await this.handleDirectDownload(ctx, url, formatArg);
      return;
    }

    // Otherwise, fetch info and display interactive hierarchical menu
    await this.showInteractiveFormatPicker(ctx, url);
  }

  private async showInteractiveFormatPicker(ctx: CommandContext, url: string): Promise<void> {
    const initMsg = await ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: "🔍 *nullptr* is inspecting link metadata & available qualities...",
      parse_mode: "Markdown",
    });

    try {
      const info = await ctx.downloader.getMediaInfo(url);
      const session = createDownloadSession(info);
      const { text, replyMarkup } = buildMainMenu(session);

      await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: initMsg.message_id,
        text,
        parse_mode: "Markdown",
        reply_markup: replyMarkup,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: initMsg.message_id,
        text: `⚠️ [nullptr] Failed to inspect link:\n${errMsg}`,
      });
    }
  }

  private async handleDirectDownload(ctx: CommandContext, url: string, formatArg: string): Promise<void> {
    let format: MediaFormat = "mp4";
    let quality: MediaQuality = "best";
    let audioBitrate: AudioBitrate = "320";

    const audioFormats: MediaFormat[] = ["mp3", "m4a", "wav", "flac", "aac", "opus"];
    const videoQualities: MediaQuality[] = [
      "best",
      "8k",
      "4k",
      "2160p",
      "1440p",
      "1080p",
      "720p",
      "480p",
      "360p",
      "240p",
      "144p",
    ];

    if (audioFormats.includes(formatArg as MediaFormat)) {
      format = formatArg as MediaFormat;
      quality = "audio";
      audioBitrate = "320";
    } else if (videoQualities.includes(formatArg as MediaQuality)) {
      format = "mp4";
      quality = formatArg as MediaQuality;
    } else if (["webm", "mkv"].includes(formatArg)) {
      format = formatArg as MediaFormat;
      quality = "best";
    }

    const progressMsg = await ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: `⏳ *nullptr* is downloading (${format.toUpperCase()} ${quality !== "audio" ? quality : "320k"})...`,
      parse_mode: "Markdown",
    });

    try {
      const result = await ctx.downloader.download({
        url,
        format,
        quality,
        audioBitrate,
      });

      const sizeMb = (result.fileSizeBytes / (1024 * 1024)).toFixed(1);

      if (!result.isAudio) {
        // Videos are served strictly via HTTP File Server (never uploaded directly to Telegram chat)
        if (ctx.fileServer && ctx.fileServer.isReady()) {
          const downloadUrl = await ctx.fileServer.registerDownload(
            result.filePath,
            result.filename,
            result.title
          );

          const text = [
            `🎬 *${result.title}*`,
            `📦 File Size: *${sizeMb} MB*`,
            "",
            ...(result.fileSizeBytes > 50 * 1024 * 1024
              ? [`ℹ️ *File exceeds Telegram's 50 MB in-chat upload limit.*`]
              : []),
            `🚀 *High-Speed Streaming & Direct Download:*`,
            `• ▶️ *Stream & Watch:* [Open Web Player](${downloadUrl})`,
            `• 📥 *Download / Save:* [Direct File Download](${downloadUrl}?dl=1)`,
            "",
            `⏱️ _This link will remain active for 2 hours._`,
          ].join("\n");

          const canShowButton = isTelegramButtonUrl(downloadUrl);
          const keyboard: InlineKeyboardMarkup | undefined = canShowButton
            ? {
                inline_keyboard: [
                  [
                    {
                      text: `▶️ Stream & Watch`,
                      url: downloadUrl,
                    },
                    {
                      text: `📥 Download (${sizeMb} MB)`,
                      url: `${downloadUrl}?dl=1`,
                    },
                  ],
                ],
              }
            : undefined;

          try {
            await ctx.telegram.editMessageText({
              chat_id: ctx.chatId,
              message_id: progressMsg.message_id,
              text,
              parse_mode: "Markdown",
              reply_markup: keyboard,
            });
          } catch (editErr: unknown) {
            ctx.logger.warn(`Failed to send rich markdown message, falling back to plain text: ${String(editErr)}`);
            await ctx.telegram.editMessageText({
              chat_id: ctx.chatId,
              message_id: progressMsg.message_id,
              text: [
                `🎬 ${result.title}`,
                `📦 File Size: ${sizeMb} MB`,
                "",
                ...(result.fileSizeBytes > 50 * 1024 * 1024
                  ? [`ℹ️ File exceeds Telegram's 50 MB in-chat upload limit.`]
                  : []),
                `🚀 High-Speed Streaming & Direct Download:`,
                `▶️ Stream & Watch: ${downloadUrl}`,
                `📥 Direct Download: ${downloadUrl}?dl=1`,
                "",
                `⏱️ This link will remain active for 2 hours.`,
              ].join("\n"),
            });
          }
          return;
        }

        await ctx.telegram.editMessageText({
          chat_id: ctx.chatId,
          message_id: progressMsg.message_id,
          text: `⚠️ [nullptr] File server is not running or unavailable. Videos cannot be served without the file server enabled.`,
          parse_mode: "Markdown",
        });
        await fs.unlink(result.filePath).catch(() => {});
        return;
      }

      // Audio handling: uploads directly to Telegram when <= 50 MB; serves via fileServer when > 50 MB
      if (result.fileSizeBytes > 50 * 1024 * 1024) {
        if (ctx.fileServer && ctx.fileServer.isReady()) {
          const downloadUrl = await ctx.fileServer.registerDownload(
            result.filePath,
            result.filename,
            result.title
          );

          const text = [
            `🎵 *${result.title}*`,
            `📦 File Size: *${sizeMb} MB*`,
            "",
            `ℹ️ *File exceeds Telegram's 50 MB in-chat upload limit.*`,
            `🚀 *High-Speed Streaming & Direct Download:*`,
            `• ▶️ *Stream & Listen:* [Open Web Player](${downloadUrl})`,
            `• 📥 *Download / Save:* [Direct File Download](${downloadUrl}?dl=1)`,
            "",
            `⏱️ _This link will remain active for 2 hours._`,
          ].join("\n");

          const canShowButton = isTelegramButtonUrl(downloadUrl);
          const keyboard: InlineKeyboardMarkup | undefined = canShowButton
            ? {
                inline_keyboard: [
                  [
                    {
                      text: `▶️ Stream & Listen`,
                      url: downloadUrl,
                    },
                    {
                      text: `📥 Download (${sizeMb} MB)`,
                      url: `${downloadUrl}?dl=1`,
                    },
                  ],
                ],
              }
            : undefined;

          try {
            await ctx.telegram.editMessageText({
              chat_id: ctx.chatId,
              message_id: progressMsg.message_id,
              text,
              parse_mode: "Markdown",
              reply_markup: keyboard,
            });
          } catch (editErr: unknown) {
            ctx.logger.warn(`Failed to send rich markdown message, falling back to plain text: ${String(editErr)}`);
            await ctx.telegram.editMessageText({
              chat_id: ctx.chatId,
              message_id: progressMsg.message_id,
              text: [
                `🎵 ${result.title}`,
                `📦 File Size: ${sizeMb} MB`,
                "",
                `ℹ️ File exceeds Telegram's 50 MB in-chat upload limit.`,
                `🚀 High-Speed Streaming & Direct Download:`,
                `▶️ Stream & Listen: ${downloadUrl}`,
                `📥 Direct Download: ${downloadUrl}?dl=1`,
                "",
                `⏱️ This link will remain active for 2 hours.`,
              ].join("\n"),
            });
          }
          return;
        }

        await ctx.telegram.editMessageText({
          chat_id: ctx.chatId,
          message_id: progressMsg.message_id,
          text: `⚠️ [nullptr] The downloaded file is *${sizeMb} MB*, which exceeds Telegram's 50 MB upload limit.\nTry selecting MP3 audio or a lower audio bitrate.`,
          parse_mode: "Markdown",
        });
        await fs.unlink(result.filePath).catch(() => {});
        return;
      }

      await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: progressMsg.message_id,
        text: `📤 Uploading to Telegram (${sizeMb} MB)...`,
      });

      await ctx.telegram.sendChatAction(ctx.chatId, "upload_voice");
      await ctx.telegram.sendAudio({
        chat_id: ctx.chatId,
        filePath: result.filePath,
        title: result.title,
        caption: `🎵 *${result.title}* via nullptr`,
        parse_mode: "Markdown",
      });

      // Cleanup audio file after Telegram upload
      await fs.unlink(result.filePath).catch(() => {});
      await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: progressMsg.message_id,
        text: `✅ *${result.title}* sent successfully!`,
        parse_mode: "Markdown",
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: progressMsg.message_id,
        text: `⚠️ [nullptr] Download failed:\n${errMsg}`,
      });
    }
  }
}
