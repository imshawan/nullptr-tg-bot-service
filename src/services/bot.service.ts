import fs from "node:fs/promises";
import { ITelegramClient } from "@/domain/telegram/telegram-client.interface";
import { ILlmProvider, ChatMessage } from "@/domain/llm/llm-provider.interface";
import { ISessionStore } from "@/domain/session/session-store.interface";
import { IDownloaderService } from "@/domain/downloader/downloader.interface";
import { MediaFormat, MediaQuality, AudioBitrate } from "@/domain/downloader/downloader.types";
import { IFileServerService } from "@/services/file-server/file-server.interface";
import { CommandRegistry } from "@/services/command.registry";
import { ILogger } from "@/core/logger/logger.interface";
import { TelegramUpdate, TelegramCallbackQuery, InlineKeyboardMarkup } from "@/domain/telegram/telegram.types";
import {
  splitMessageText,
  isTelegramButtonUrl,
  parseDownloadDirective,
  cleanDownloadDirective,
  detectDownloadIntent,
} from "@/utils/text.utils";
import { TelegramApiError } from "@/core/errors/app-error";
import {
  createDownloadSession,
  buildMainMenu,
  buildVideoMenu,
  buildAudioMenu,
  pendingDownloadSessions,
} from "@/services/downloader/downloader-ui.helper";

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
      const reply = await this.streamLlmReply(chatId, history, text);
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
      text: "🔍 *nullptr* detected media link. Fetching details & qualities...",
      parse_mode: "Markdown",
    });

    try {
      const info = await this.downloader.getMediaInfo(url);
      const session = createDownloadSession(info);
      const { text, replyMarkup } = buildMainMenu(session);

      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: initMsg.message_id,
        text,
        parse_mode: "Markdown",
        reply_markup: replyMarkup,
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
   * Handles user tapping an Inline Keyboard button (e.g. format choice, drilldown menu, back, cancel)
   */
  private async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    const data = query.data;
    if (!data || !data.startsWith("dl:")) return;

    await this.telegram.answerCallbackQuery({
      callback_query_id: query.id,
      text: "nullptr is processing your request...",
    });

    const parts = data.split(":");
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;

    if (!chatId || !messageId) return;

    // 1. Cancel action: dl:cancel:none:${token}
    if (parts[1] === "cancel") {
      const token = parts[3];
      if (token) pendingDownloadSessions.delete(token);
      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: "❌ Download cancelled.",
      });
      return;
    }

    // 2. Back action: dl:back:${token}
    if (parts[1] === "back") {
      const token = parts[2];
      const session = pendingDownloadSessions.get(token);
      if (!session) {
        await this.telegram.editMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: "⚠️ Download session expired. Please send the link again.",
        });
        return;
      }
      const { text, replyMarkup } = buildMainMenu(session);
      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "Markdown",
        reply_markup: replyMarkup,
      });
      return;
    }

    // 3. Video drilldown menu: dl:v_menu:${token}
    if (parts[1] === "v_menu") {
      const token = parts[2];
      const session = pendingDownloadSessions.get(token);
      if (!session) {
        await this.telegram.editMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: "⚠️ Download session expired. Please send the link again.",
        });
        return;
      }
      const { text, replyMarkup } = buildVideoMenu(session);
      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "Markdown",
        reply_markup: replyMarkup,
      });
      return;
    }

    // 4. Audio drilldown menu: dl:a_menu:${token}
    if (parts[1] === "a_menu") {
      const token = parts[2];
      const session = pendingDownloadSessions.get(token);
      if (!session) {
        await this.telegram.editMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: "⚠️ Download session expired. Please send the link again.",
        });
        return;
      }
      const { text, replyMarkup } = buildAudioMenu(session);
      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "Markdown",
        reply_markup: replyMarkup,
      });
      return;
    }

    // 5. Video format switch: dl:v_fmt:${format}:${token}
    if (parts[1] === "v_fmt") {
      const format = parts[2] as "mp4" | "mkv" | "webm";
      const token = parts[3];
      const session = pendingDownloadSessions.get(token);
      if (!session) {
        await this.telegram.editMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: "⚠️ Download session expired. Please send the link again.",
        });
        return;
      }
      session.selectedVideoFormat = format;
      const { text, replyMarkup } = buildVideoMenu(session);
      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "Markdown",
        reply_markup: replyMarkup,
      });
      return;
    }

    // 6. Audio format switch: dl:a_fmt:${format}:${token}
    if (parts[1] === "a_fmt") {
      const format = parts[2] as any;
      const token = parts[3];
      const session = pendingDownloadSessions.get(token);
      if (!session) {
        await this.telegram.editMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: "⚠️ Download session expired. Please send the link again.",
        });
        return;
      }
      session.selectedAudioFormat = format;
      const { text, replyMarkup } = buildAudioMenu(session);
      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "Markdown",
        reply_markup: replyMarkup,
      });
      return;
    }

    // 7. Download execution triggers
    let format: MediaFormat = "mp4";
    let quality: MediaQuality = "best";
    let audioBitrate: AudioBitrate | undefined = undefined;
    let token = "";

    if (parts[1] === "q" && parts[2] === "v") {
      // dl:q:v:${token} -> Quick Best MP4
      token = parts[3];
      format = "mp4";
      quality = "best";
    } else if (parts[1] === "q" && parts[2] === "a") {
      // dl:q:a:${token} -> Quick MP3 320k
      token = parts[3];
      format = "mp3";
      quality = "audio";
      audioBitrate = "320";
    } else if (parts[1] === "v_run") {
      // dl:v_run:${format}:${quality}:${token}
      format = parts[2] as MediaFormat;
      quality = parts[3] as MediaQuality;
      token = parts[4];
    } else if (parts[1] === "a_run") {
      // dl:a_run:${format}:${bitrate}:${token}
      format = parts[2] as MediaFormat;
      audioBitrate = (parts[3] === "lossless" ? undefined : parts[3]) as AudioBitrate;
      quality = "audio";
      token = parts[4];
    } else {
      // Backward compatibility: dl:${format}:${quality}:${token}
      format = parts[1] as MediaFormat;
      quality = parts[2] as MediaQuality;
      token = parts[3];
      if (quality === "audio") audioBitrate = "320";
    }

    const session = pendingDownloadSessions.get(token);
    if (!session) {
      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: "⚠️ Download session expired. Please send the link again.",
      });
      return;
    }

    await this.executeDownloadWithOptions(chatId, {
      url: session.url,
      format,
      quality,
      audioBitrate,
      title: session.title,
      progressMessageId: messageId,
      token,
    });
  }

  /**
   * Scans conversation history backwards to locate the most recent supported media URL.
   */
  private findLastMediaUrlInHistory(messages: ChatMessage[]): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const content = messages[i]?.content;
      if (!content) continue;
      const url = this.downloader.extractUrl(content);
      if (url && this.downloader.isSupportedUrl(url)) {
        return url;
      }
    }
    return null;
  }

  /**
   * Direct media download execution triggered by LLM or direct command.
   */
  public async executeDirectDownload(
    chatId: number,
    url: string,
    formatArg?: string,
    existingMessageId?: number
  ): Promise<void> {
    let format: MediaFormat = "mp4";
    let quality: MediaQuality = "best";
    let audioBitrate: AudioBitrate = "320";

    const normalizedArg = (formatArg || "best").toLowerCase().trim();
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

    if (audioFormats.includes(normalizedArg as MediaFormat)) {
      format = normalizedArg as MediaFormat;
      quality = "audio";
      audioBitrate = "320";
    } else if (["audio", "song", "music"].includes(normalizedArg)) {
      format = "mp3";
      quality = "audio";
      audioBitrate = "320";
    } else if (videoQualities.includes(normalizedArg as MediaQuality)) {
      format = "mp4";
      quality = normalizedArg as MediaQuality;
    } else if (["webm", "mkv"].includes(normalizedArg)) {
      format = normalizedArg as MediaFormat;
      quality = "best";
    }

    await this.executeDownloadWithOptions(chatId, {
      url,
      format,
      quality,
      audioBitrate,
      progressMessageId: existingMessageId,
    });
  }

  /**
   * Core download runner: downloads media via yt-dlp and delivers via HTTP File Server (video / audio > 50MB)
   * or direct Telegram sendAudio (audio <= 50MB).
   */
  private async executeDownloadWithOptions(
    chatId: number,
    options: {
      url: string;
      format: MediaFormat;
      quality: MediaQuality;
      audioBitrate?: AudioBitrate;
      title?: string;
      progressMessageId?: number;
      token?: string;
    }
  ): Promise<void> {
    const { url, format, quality, audioBitrate, title, progressMessageId, token } = options;
    const qualityLabel = quality !== "audio" ? ` · ${quality}` : audioBitrate ? ` · ${audioBitrate}k` : "";
    const labelTitle = title ? `*${title}* ` : "";
    const progressText = `⏳ *nullptr* is downloading: ${labelTitle}(${format.toUpperCase()}${qualityLabel})...\nPlease wait.`;

    let activeMsgId = progressMessageId;
    if (activeMsgId) {
      try {
        await this.telegram.editMessageText({
          chat_id: chatId,
          message_id: activeMsgId,
          text: progressText,
          parse_mode: "Markdown",
        });
      } catch {
        const msg = await this.telegram.sendMessage({
          chat_id: chatId,
          text: progressText,
          parse_mode: "Markdown",
        });
        activeMsgId = msg.message_id;
      }
    } else {
      const msg = await this.telegram.sendMessage({
        chat_id: chatId,
        text: progressText,
        parse_mode: "Markdown",
      });
      activeMsgId = msg.message_id;
    }

    try {
      const result = await this.downloader.download({
        url,
        format,
        quality,
        audioBitrate,
      });

      const sizeMb = (result.fileSizeBytes / (1024 * 1024)).toFixed(1);

      if (!result.isAudio) {
        // Videos are served strictly via the HTTP File Server (never uploaded directly to Telegram chat)
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
            await this.telegram.editMessageText({
              chat_id: chatId,
              message_id: activeMsgId!,
              text,
              parse_mode: "Markdown",
              reply_markup: keyboard,
            });
          } catch (editErr: unknown) {
            this.logger.warn(`Failed to send rich markdown message, falling back to plain text: ${String(editErr)}`);
            await this.telegram.editMessageText({
              chat_id: chatId,
              message_id: activeMsgId!,
              text: [
                `🎬 ${result.title}`,
                `📦 File Size: ${sizeMb} MB`,
                "",
                `🚀 High-Speed Streaming & Direct Download:`,
                `▶️ Stream & Watch: ${downloadUrl}`,
                `📥 Direct Download: ${downloadUrl}?dl=1`,
                "",
                `⏱️ This link will remain active for 2 hours.`,
              ].join("\n"),
            });
          }
          if (token) pendingDownloadSessions.delete(token);
          return;
        }

        await this.telegram.editMessageText({
          chat_id: chatId,
          message_id: activeMsgId!,
          text: `⚠️ [nullptr] File server is not running or unavailable. Videos cannot be served without the file server enabled.`,
          parse_mode: "Markdown",
        });
        await fs.unlink(result.filePath).catch(() => {});
        if (token) pendingDownloadSessions.delete(token);
        return;
      }

      // Audio handling: uploads directly to Telegram when <= 50 MB; serves via fileServer when > 50 MB
      if (result.fileSizeBytes > 50 * 1024 * 1024) {
        if (this.fileServer && this.fileServer.isReady()) {
          const downloadUrl = await this.fileServer.registerDownload(
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
            await this.telegram.editMessageText({
              chat_id: chatId,
              message_id: activeMsgId!,
              text,
              parse_mode: "Markdown",
              reply_markup: keyboard,
            });
          } catch (editErr: unknown) {
            this.logger.warn(`Failed to send rich markdown message, falling back to plain text: ${String(editErr)}`);
            await this.telegram.editMessageText({
              chat_id: chatId,
              message_id: activeMsgId!,
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
          if (token) pendingDownloadSessions.delete(token);
          return;
        }

        await this.telegram.editMessageText({
          chat_id: chatId,
          message_id: activeMsgId!,
          text: `⚠️ [nullptr] The downloaded file is *${sizeMb} MB*, which exceeds Telegram's 50 MB upload limit.\nTry selecting a lower audio bitrate like 128k or 192k!`,
          parse_mode: "Markdown",
        });
        await fs.unlink(result.filePath).catch(() => {});
        if (token) pendingDownloadSessions.delete(token);
        return;
      }

      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: activeMsgId!,
        text: `📤 Uploading to Telegram (*${sizeMb} MB*)...`,
        parse_mode: "Markdown",
      });

      await this.telegram.sendChatAction(chatId, "upload_voice");
      await this.telegram.sendAudio({
        chat_id: chatId,
        filePath: result.filePath,
        title: result.title,
        caption: `🎵 *${result.title}* via nullptr`,
        parse_mode: "Markdown",
      });

      await fs.unlink(result.filePath).catch(() => {});
      if (token) pendingDownloadSessions.delete(token);

      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: activeMsgId!,
        text: `✅ *${result.title}* downloaded and delivered successfully!`,
        parse_mode: "Markdown",
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[nullptr] Download execution failed for ${url}: ${errMsg}`, err);
      if (activeMsgId) {
        await this.telegram.editMessageText({
          chat_id: chatId,
          message_id: activeMsgId,
          text: `⚠️ [nullptr] Download failed:\n${errMsg}`,
        });
      } else {
        await this.telegram.sendMessage({
          chat_id: chatId,
          text: `⚠️ [nullptr] Download failed:\n${errMsg}`,
        });
      }
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
   * Streams LLM response to Telegram with throttled editing, typing heartbeat, directive extraction, and rate-limit backoff.
   */
  private async streamLlmReply(chatId: number, messages: ChatMessage[], userInput?: string): Promise<string> {
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
          const cleanText = cleanDownloadDirective(fullContent);
          const previewText = cleanText ? `${cleanText} ▍` : "nullptr is processing your request... ▍";
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

      const finalRawReply = fullContent.trim();
      const directive = parseDownloadDirective(finalRawReply);
      let cleanedReply = cleanDownloadDirective(finalRawReply);
      let targetUrl = directive?.url;
      let targetFormat = directive?.format;

      // Fallback: If LLM omitted directive tag, detect download intent from current message or recent history
      if (!targetUrl && userInput) {
        const userUrl = this.downloader.extractUrl(userInput);
        const intent = detectDownloadIntent(userInput);
        if (userUrl && this.downloader.isSupportedUrl(userUrl) && intent.hasIntent) {
          targetUrl = userUrl;
          targetFormat = intent.format;
          this.logger.info(`[Intent Fallback] Detected download request for: ${targetUrl} (format: ${targetFormat || "interactive"})`);
        } else if (intent.hasIntent) {
          const historyUrl = this.findLastMediaUrlInHistory(messages);
          if (historyUrl) {
            targetUrl = historyUrl;
            targetFormat = intent.format;
            this.logger.info(`[History Fallback] Found media URL in conversation history: ${targetUrl} (format: ${targetFormat || "interactive"})`);
          }
        }
      }

      if (!cleanedReply) {
        cleanedReply = targetFormat
          ? `⏳ Starting direct download for your requested media (${targetFormat.toUpperCase()})...`
          : "🔍 Inspecting media link and preparing available format options...";
      }

      // Deliver final output (with rich markdown + fallback)
      if (placeholderMsgId && cleanedReply.length <= 4000) {
        await this.deliverMessage(chatId, cleanedReply, placeholderMsgId);
      } else {
        const chunks = splitMessageText(cleanedReply, 4000);
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

      // Trigger download flow if a target URL was identified
      if (targetUrl && this.downloader.isSupportedUrl(targetUrl)) {
        this.logger.info(`[Downloader Trigger] Starting download flow for: ${targetUrl} (format: ${targetFormat || "interactive"})`);
        if (targetFormat) {
          await this.executeDirectDownload(chatId, targetUrl, targetFormat);
        } else {
          await this.handleDirectUrlSubmission(chatId, targetUrl);
        }
      }

      return cleanedReply;
    } finally {
      clearInterval(typingTimer);
      clearTimeout(timeout);
    }
  }
}
