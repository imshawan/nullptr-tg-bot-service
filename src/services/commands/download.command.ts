import fs from "node:fs/promises";
import { ICommandHandler, CommandContext } from "@/services/commands/command.interface";
import { MediaFormat, MediaQuality } from "@/domain/downloader/downloader.types";
import { InlineKeyboardMarkup } from "@/domain/telegram/telegram.types";
import { formatDuration, isTelegramButtonUrl } from "@/utils/text.utils";

// In-memory cache for pending interactive download selections: token -> URL
export const pendingDownloadUrls = new Map<string, { url: string; title: string; createdAt: number }>();

// Cleanup stale tokens older than 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingDownloadUrls.entries()) {
    if (now - val.createdAt > 30 * 60 * 1000) {
      pendingDownloadUrls.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();

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
        "• *Audio formats:* `mp3`, `m4a`",
        "• *Video qualities:* `best`, `720p`, `480p`",
        "",
        "💡 _Tip: You can also simply paste any video link in chat to open the interactive format selector!_",
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

    // If explicit format requested (e.g. /dl <url> mp3)
    if (formatArg) {
      await this.handleDirectDownload(ctx, url, formatArg);
      return;
    }

    // Otherwise, fetch info and display interactive format picker
    await this.showInteractiveFormatPicker(ctx, url);
  }

  private async showInteractiveFormatPicker(ctx: CommandContext, url: string): Promise<void> {
    const initMsg = await ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: "🔍 *nullptr* is inspecting link metadata...",
      parse_mode: "Markdown",
    });

    try {
      const info = await ctx.downloader.getMediaInfo(url);
      const token = Math.random().toString(36).substring(2, 10);
      pendingDownloadUrls.set(token, { url, title: info.title, createdAt: Date.now() });

      const durationStr = info.duration ? ` · ⏱️ ${formatDuration(info.duration)}` : "";
      const uploaderStr = info.uploader ? ` · 👤 ${info.uploader}` : "";

      const text = [
        `🎬 *${info.title}*`,
        `${durationStr}${uploaderStr}`,
        "",
        "Choose your desired download format:",
      ].join("\n");

      const keyboard: InlineKeyboardMarkup = {
        inline_keyboard: [
          [
            { text: "🎵 Audio (MP3 320k)", callback_data: `dl:mp3:audio:${token}` },
            { text: "🎵 Audio (M4A)", callback_data: `dl:m4a:audio:${token}` },
          ],
          [
            { text: "🎬 Video (Best MP4)", callback_data: `dl:mp4:best:${token}` },
            { text: "🎬 Video (720p)", callback_data: `dl:mp4:720p:${token}` },
          ],
          [
            { text: "🎬 Video (480p)", callback_data: `dl:mp4:480p:${token}` },
            { text: "❌ Cancel", callback_data: `dl:cancel:none:${token}` },
          ],
        ],
      };

      await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: initMsg.message_id,
        text,
        parse_mode: "Markdown",
        reply_markup: keyboard,
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

    if (["mp3", "m4a", "wav"].includes(formatArg)) {
      format = formatArg as MediaFormat;
      quality = "audio";
    } else if (["720p", "480p", "360p", "1080p", "best"].includes(formatArg)) {
      format = "mp4";
      quality = formatArg as MediaQuality;
    }

    const progressMsg = await ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: `⏳ *nullptr* is downloading (${format.toUpperCase()})...`,
      parse_mode: "Markdown",
    });

    try {
      const result = await ctx.downloader.download({
        url,
        format,
        quality,
      });

      const sizeMb = (result.fileSizeBytes / (1024 * 1024)).toFixed(1);
      if (result.fileSizeBytes > 50 * 1024 * 1024) {
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
            `ℹ️ *File exceeds Telegram's 50 MB in-chat upload limit.*`,
            `🚀 *Direct high-speed download link (No Size Limit):*`,
            `${downloadUrl}`,
            "",
            `⏱️ _This link will remain active for 2 hours._`,
          ].join("\n");

          const canShowButton = isTelegramButtonUrl(downloadUrl);
          const keyboard: InlineKeyboardMarkup | undefined = canShowButton
            ? {
                inline_keyboard: [
                  [
                    {
                      text: `📥 Download (${sizeMb} MB)`,
                      url: downloadUrl,
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
                `ℹ️ File exceeds Telegram's 50 MB in-chat upload limit.`,
                `🚀 Direct high-speed download link (No Size Limit):`,
                `${downloadUrl}`,
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
          text: `⚠️ [nullptr] The downloaded file is *${sizeMb} MB*, which exceeds Telegram's 50 MB upload limit.\nTry selecting MP3 audio or a lower video resolution (e.g. 480p).`,
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

      if (result.isAudio) {
        await ctx.telegram.sendChatAction(ctx.chatId, "upload_voice");
        await ctx.telegram.sendAudio({
          chat_id: ctx.chatId,
          filePath: result.filePath,
          title: result.title,
          caption: `🎵 *${result.title}* via nullptr`,
          parse_mode: "Markdown",
        });
      } else {
        await ctx.telegram.sendChatAction(ctx.chatId, "upload_video");
        await ctx.telegram.sendVideo({
          chat_id: ctx.chatId,
          filePath: result.filePath,
          caption: `🎬 *${result.title}* via nullptr`,
          parse_mode: "Markdown",
          supports_streaming: true,
        });
      }

      // Cleanup
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
