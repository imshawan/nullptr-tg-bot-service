import { ITelegramClient } from "@/domain/telegram/telegram-client.interface";
import { ILlmProvider, ChatMessage } from "@/domain/llm/llm-provider.interface";
import { ISessionStore } from "@/domain/session/session-store.interface";
import { CommandRegistry } from "@/services/command.registry";
import { ILogger } from "@/core/logger/logger.interface";
import { TelegramUpdate } from "@/domain/telegram/telegram.types";
import { splitMessageText } from "@/utils/text.utils";
import { TelegramApiError } from "@/core/errors/app-error";

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
    private readonly commandRegistry: CommandRegistry,
    logger: ILogger
  ) {
    this.logger = logger.child("BotService");
  }

  /**
   * Initializes nullptr bot, registers Telegram slash commands, and verifies LLM connection.
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
   * Processes a single Telegram update
   */
  private async processUpdate(update: TelegramUpdate): Promise<void> {
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

    // Command Dispatch
    if (text.startsWith("/")) {
      const handled = await this.commandRegistry.dispatch(text, {
        chatId,
        senderId,
        telegram: this.telegram,
        llm: this.llm,
        sessionStore: this.sessionStore,
        logger: this.logger,
      });
      if (handled) return;
    }

    // Regular Chat Flow -> LLM
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
   * Streams LLM response to Telegram with throttled editing and rate-limit backoff
   */
  private async streamLlmReply(chatId: number, messages: ChatMessage[]): Promise<string> {
    // Show typing status in chat header
    await this.telegram.sendChatAction(chatId, "typing");

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

      // Deliver final output
      if (placeholderMsgId && finalReply.length <= 4000) {
        if (finalReply !== lastEditedText) {
          await this.telegram.editMessageText({
            chat_id: chatId,
            message_id: placeholderMsgId,
            text: finalReply,
          });
        }
      } else {
        const chunks = splitMessageText(finalReply, 4000);
        if (placeholderMsgId) {
          await this.telegram.editMessageText({
            chat_id: chatId,
            message_id: placeholderMsgId,
            text: chunks[0],
          });
          for (let i = 1; i < chunks.length; i++) {
            await this.telegram.sendMessage({
              chat_id: chatId,
              text: chunks[i],
            });
          }
        } else {
          for (const chunk of chunks) {
            await this.telegram.sendMessage({
              chat_id: chatId,
              text: chunk,
            });
          }
        }
      }

      return finalReply;
    } finally {
      clearTimeout(timeout);
    }
  }
}
