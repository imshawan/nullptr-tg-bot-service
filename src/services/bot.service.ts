import fs from "node:fs/promises";
import { ITelegramClient } from "@/domain/telegram/telegram-client.interface";
import { ILlmProvider, ChatMessage } from "@/domain/llm/llm-provider.interface";
import { ISessionStore } from "@/domain/session/session-store.interface";
import { IDownloaderService } from "@/domain/downloader/downloader.interface";
import { MediaFormat, MediaQuality } from "@/domain/downloader/downloader.types";
import { IFileServerService } from "@/services/file-server/file-server.interface";
import { CommandRegistry } from "@/services/command.registry";
import { ILogger } from "@/core/logger/logger.interface";
import { TelegramUpdate, TelegramCallbackQuery, InlineKeyboardMarkup } from "@/domain/telegram/telegram.types";
import { splitMessageText, formatDuration, isTelegramButtonUrl } from "@/utils/text.utils";
import { TelegramApiError } from "@/core/errors/app-error";
import { pendingDownloadUrls } from "@/services/commands/download.command";

export interface BotServiceConfig {
  allowedUserIds: Set<number>;
  streamEditIntervalMs: number;
}

export class BotService {
  private updateOffset = 0;
  private isRunning = false;
  private readonly logger: ILogger;

  constructor(
    private readonly config: BotServiceConfig,
    private readonly telegram: ITelegramClient,
    private readonly llm: ILlmProvider,
    private readonly sessionStore: ISessionStore,
    private readonly downloader: IDownloaderService,
    private readonly commandRegistry: CommandRegistry,
    private readonly fileServer: IFileServerService,
    logger: ILogger
  ) {
    this.logger = logger.child("BotService");
  }

  /**
   * Initializes nullptr bot, registers Telegram slash commands, and verifies LLM & Downloader readiness.
   */
  public async init(): Promise<void> {
    this.logger.info("Initializing nullptr (NullPointer Bot) Service...");

    // 1. Register commands with Telegram to display slash menu popup
    const botCommands = this.commandRegistry.getBotCommands();
    await this.telegram.setMyCommands(botCommands);
    await this.telegram.setChatMenuButton("commands");

    // 2. Health check to Oracle Cloud Ollama
    const health = await this.llm.checkHealth();
    if (health.ok) {
      this.logger.info(
        `[nullptr] Connected to LLM host (${this.llm.getHost()}). Active model: ${this.llm.getActiveModel()} | Models found: ${health.availableModelsCount}`
      );
    } else {
      this.logger.warn(
        `[nullptr] LLM host (${this.llm.getHost()}) unreachable: ${health.error}. (Verify Oracle Cloud security lists & iptables).`
      );
    }
  }

  /**
   * Begins Telegram update polling loop
   */
  public async start(): Promise<void> {
    this.isRunning = true;
    this.logger.info("Starting nullptr (NullPointer Bot) Telegram long-polling loop...");

    while (this.isRunning) {
      try {
        const updates = await this.telegram.getUpdates(this.updateOffset, 30);
        for (const update of updates) {
          this.updateOffset = update.update_id + 1;
          await this.processUpdate(update);
        }
      } catch (err: unknown) {
        if (!this.isRunning) break;

        if (err instanceof TelegramApiError && err.errorCode === 429 && err.retryAfter) {
          this.logger.warn(`[nullptr] Rate-limited by Telegram during getUpdates. Waiting ${err.retryAfter}s...`);
          await new Promise((r) => setTimeout(r, err.retryAfter! * 1000));
        } else {
          this.logger.error("[nullptr] Polling error:", err);
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
    }

    this.logger.info("nullptr (NullPointer Bot) Telegram polling stopped.");
  }

  /**
   * Stops the polling loop gracefully
   */
  public stop(): void {
    this.logger.info("Shutting down nullptr (NullPointer Bot) service...");
    this.isRunning = false;
  }

  /**
   * Processes an incoming update (Message or Inline Callback Query)
   */
  private async processUpdate(update: TelegramUpdate): Promise<void> {
    // 1. Handle Inline Keyboard Callback Queries (e.g. Media format buttons)
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    const msg = update.message;
    if (!msg || !msg.text) return;

    const chatId = msg.chat.id;
    const senderId = msg.from?.id;

    // Security Gate / Authorization
    if (this.config.allowedUserIds.size > 0 && (!senderId || !this.config.allowedUserIds.has(senderId))) {
      this.logger.warn(`[Security] Blocked unauthorized access attempt to nullptr from ID: ${senderId} (@${msg.from?.username || "unknown"})`);
      await this.telegram.sendMessage({
        chat_id: chatId,
        text: `⛔ Access denied. Your Telegram ID (${senderId}) is not authorized to use nullptr (NullPointer Bot).`,
      });
      return;
    }

    const text = msg.text.trim();

    // 2. Command Dispatch (/start, /help, /download, /models, etc.)
    if (text.startsWith("/")) {
      const handled = await this.commandRegistry.dispatch(text, {
        chatId,
        senderId,
        telegram: this.telegram,
        llm: this.llm,
        sessionStore: this.sessionStore,
        downloader: this.downloader,
        fileServer: this.fileServer,
        logger: this.logger,
      });
      if (handled) return;
    }

    // 3. Direct Link Detection (e.g. user pasted YouTube, Twitter/X, TikTok link directly)
    const detectedUrl = this.downloader.extractUrl(text);
    if (detectedUrl && this.downloader.isSupportedUrl(detectedUrl) && !text.includes(" ")) {
      await this.handleDirectUrlSubmission(chatId, detectedUrl);
      return;
    }

    // 4. Regular Chat Flow -> LLM Inference
    await this.sessionStore.appendMessage(chatId, { role: "user", content: text });
    const history = await this.sessionStore.getHistory(chatId);

    try {
      const reply = await this.streamLlmReply(chatId, history);
      await this.sessionStore.appendMessage(chatId, { role: "assistant", content: reply });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[nullptr] Error during LLM chat processing: ${errMsg}`, err);
      await this.telegram.sendMessage({
        chat_id: chatId,
        text: `⚠️ [nullptr] Error communicating with LLM at ${this.llm.getHost()}:\n${errMsg}`,
      });
    }
  }

  /**
   * Shows format picker when user simply pastes a video/audio link into chat
   */
  private async handleDirectUrlSubmission(chatId: number, url: string): Promise<void> {
    const initMsg = await this.telegram.sendMessage({
      chat_id: chatId,
      text: "🔍 *nullptr* detected media link. Fetching details...",
      parse_mode: "Markdown",
    });

    try {
      const info = await this.downloader.getMediaInfo(url);
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

      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: initMsg.message_id,
        text,
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: initMsg.message_id,
        text: `⚠️ [nullptr] Could not inspect media link:\n${errMsg}`,
      });
    }
  }

  /**
   * Handles user tapping an Inline Keyboard button (e.g. format choice)
   */
  private async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    const data = query.data;
    if (!data || !data.startsWith("dl:")) return;

    await this.telegram.answerCallbackQuery({
      callback_query_id: query.id,
      text: "nullptr is processing your request...",
    });

    const [_, format, quality, token] = data.split(":");
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;

    if (!chatId || !messageId) return;

    if (format === "cancel") {
      pendingDownloadUrls.delete(token);
      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: "❌ Download cancelled.",
      });
      return;
    }

    const pending = pendingDownloadUrls.get(token);
    if (!pending) {
      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: "⚠️ Download session expired. Please send the link again.",
      });
      return;
    }

    // Update status message
    await this.telegram.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: `⏳ *nullptr* is downloading: *${pending.title}* (${format.toUpperCase()})...\nPlease wait.`,
      parse_mode: "Markdown",
    });

    try {
      const result = await this.downloader.download({
        url: pending.url,
        format: format as MediaFormat,
        quality: quality as MediaQuality,
      });

      const sizeMb = (result.fileSizeBytes / (1024 * 1024)).toFixed(1);

      if (result.fileSizeBytes > 50 * 1024 * 1024) {
        if (this.fileServer && this.fileServer.isReady()) {
          const downloadUrl = await this.fileServer.registerDownload(
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
            await this.telegram.editMessageText({
              chat_id: chatId,
              message_id: messageId,
              text,
              parse_mode: "Markdown",
              reply_markup: keyboard,
            });
          } catch (editErr: unknown) {
            this.logger.warn(`Failed to send rich markdown message, falling back to plain text: ${String(editErr)}`);
            await this.telegram.editMessageText({
              chat_id: chatId,
              message_id: messageId,
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
          pendingDownloadUrls.delete(token);
          return;
        }

        await this.telegram.editMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: `⚠️ [nullptr] The downloaded file is *${sizeMb} MB*, which exceeds Telegram's 50 MB upload limit.\nTry selecting MP3 audio or a lower video resolution like 480p!`,
          parse_mode: "Markdown",
        });
        await fs.unlink(result.filePath).catch(() => {});
        pendingDownloadUrls.delete(token);
        return;
      }

      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: `📤 Uploading to Telegram (*${sizeMb} MB*)...`,
        parse_mode: "Markdown",
      });

      if (result.isAudio) {
        await this.telegram.sendChatAction(chatId, "upload_voice");
        await this.telegram.sendAudio({
          chat_id: chatId,
          filePath: result.filePath,
          title: result.title,
          caption: `🎵 *${result.title}* via nullptr`,
          parse_mode: "Markdown",
        });
      } else {
        await this.telegram.sendChatAction(chatId, "upload_video");
        await this.telegram.sendVideo({
          chat_id: chatId,
          filePath: result.filePath,
          caption: `🎬 *${result.title}* via nullptr`,
          parse_mode: "Markdown",
          supports_streaming: true,
        });
      }

      await fs.unlink(result.filePath).catch(() => {});
      pendingDownloadUrls.delete(token);

      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: `✅ *${result.title}* downloaded and sent successfully!`,
        parse_mode: "Markdown",
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error("Download failed:", err);
      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: `⚠️ [nullptr] Download failed:\n${errMsg}`,
      });
    }
  }

  /**
   * Delivers message text with Markdown formatting and automatic plain-text fallback.
   */
  private async deliverMessage(
    chatId: number,
    text: string,
    existingMessageId?: number
  ): Promise<void> {
    if (existingMessageId) {
      try {
        await this.telegram.editMessageText({
          chat_id: chatId,
          message_id: existingMessageId,
          text,
          parse_mode: "Markdown",
        });
        return;
      } catch {
        // Fallback to unformatted plain text if Telegram fails entity parsing
        await this.telegram.editMessageText({
          chat_id: chatId,
          message_id: existingMessageId,
          text,
        });
        return;
      }
    }

    try {
      await this.telegram.sendMessage({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      });
    } catch {
      await this.telegram.sendMessage({
        chat_id: chatId,
        text,
      });
    }
  }

  /**
   * Streams LLM response to Telegram with throttled editing, typing heartbeat, and rate-limit backoff
   */
  private async streamLlmReply(chatId: number, messages: ChatMessage[]): Promise<string> {
    // Show typing status in chat header
    await this.telegram.sendChatAction(chatId, "typing");

    // Recurring typing indicator heartbeat while waiting for the first tokens
    let isStreaming = false;
    const typingTimer = setInterval(() => {
      if (!isStreaming) {
        this.telegram.sendChatAction(chatId, "typing").catch(() => {});
      } else {
        clearInterval(typingTimer);
      }
    }, 4500);

    // Placeholder message
    const placeholderMsg = await this.telegram.sendMessage({
      chat_id: chatId,
      text: "nullptr is thinking...",
    });
    const placeholderMsgId = placeholderMsg.message_id;

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 10 * 60 * 1000); // 10 min safety timeout

    let fullContent = "";
    let lastEditTime = Date.now();
    let lastEditedText = "";
    const throttleMs = this.config.streamEditIntervalMs;

    try {
      for await (const chunk of this.llm.chatStream(messages, abortController.signal)) {
        isStreaming = true;
        fullContent += chunk.content;

        const now = Date.now();
        if (
          placeholderMsgId &&
          fullContent.trim().length > 0 &&
          fullContent.length <= 3900 &&
          now - lastEditTime >= throttleMs
        ) {
          const previewText = `${fullContent} ▍`;
          if (previewText !== lastEditedText) {
            try {
              await this.telegram.editMessageText({
                chat_id: chatId,
                message_id: placeholderMsgId,
                text: previewText,
              });
              lastEditedText = previewText;
              lastEditTime = now;
            } catch (err: unknown) {
              if (err instanceof TelegramApiError && err.errorCode === 429 && err.retryAfter) {
                lastEditTime = now + err.retryAfter * 1000;
              }
            }
          }
        }
      }

      const finalReply = fullContent.trim() || "(Empty response received from nullptr)";

      // Deliver final output (with rich markdown + fallback)
      if (placeholderMsgId && finalReply.length <= 4000) {
        await this.deliverMessage(chatId, finalReply, placeholderMsgId);
      } else {
        const chunks = splitMessageText(finalReply, 4000);
        if (placeholderMsgId) {
          await this.deliverMessage(chatId, chunks[0], placeholderMsgId);
          for (let i = 1; i < chunks.length; i++) {
            await this.deliverMessage(chatId, chunks[i]);
          }
        } else {
          for (const chunk of chunks) {
            await this.deliverMessage(chatId, chunk);
          }
        }
      }

      return finalReply;
    } finally {
      clearInterval(typingTimer);
      clearTimeout(timeout);
    }
  }
}
