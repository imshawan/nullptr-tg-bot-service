import { ITelegramClient } from "@/domain/telegram/telegram-client.interface";
import {
  TelegramUpdate,
  TelegramMessage,
  SendMessageOptions,
  EditMessageTextOptions,
  BotCommand,
  ChatAction,
  TelegramApiResponse,
} from "@/domain/telegram/telegram.types";
import { TelegramApiError } from "@/core/errors/app-error";
import { ILogger } from "@/core/logger/logger.interface";

export class TelegramClient implements ITelegramClient {
  private readonly baseUrl: string;
  private readonly logger: ILogger;

  constructor(token: string, logger: ILogger) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.logger = logger.child("TelegramClient");
  }

  private async request<T = unknown>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    let res: Response;

    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TelegramApiError(`Network failure during '${method}': ${msg}`, method);
    }

    const data = (await res.json()) as TelegramApiResponse<T>;

    if (!data.ok) {
      const retryAfter = data.parameters?.retry_after;
      const isExpectedNonCritical = data.error_code === 400 && data.description?.includes("message is not modified");

      if (!isExpectedNonCritical) {
        this.logger.warn(`Telegram API error on ${method}: [${data.error_code}] ${data.description}`);
      }

      throw new TelegramApiError(
        data.description || "Unknown Telegram API error",
        method,
        data.error_code,
        retryAfter
      );
    }

    return data.result as T;
  }

  public async getUpdates(offset: number, timeoutSeconds: number = 30): Promise<TelegramUpdate[]> {
    return this.request<TelegramUpdate[]>("getUpdates", {
      offset,
      timeout: timeoutSeconds,
    });
  }

  public async sendMessage(options: SendMessageOptions): Promise<TelegramMessage> {
    return this.request<TelegramMessage>("sendMessage", {
      chat_id: options.chat_id,
      text: options.text,
      parse_mode: options.parse_mode,
      reply_to_message_id: options.reply_to_message_id,
    });
  }

  public async editMessageText(options: EditMessageTextOptions): Promise<TelegramMessage | null> {
    try {
      return await this.request<TelegramMessage>("editMessageText", {
        chat_id: options.chat_id,
        message_id: options.message_id,
        text: options.text,
        parse_mode: options.parse_mode,
      });
    } catch (err: unknown) {
      // If message content is unmodified, return null cleanly without blowing up
      if (err instanceof TelegramApiError && err.errorCode === 400 && err.message.includes("message is not modified")) {
        return null;
      }
      throw err;
    }
  }

  public async sendChatAction(chatId: number | string, action: ChatAction): Promise<boolean> {
    try {
      return await this.request<boolean>("sendChatAction", {
        chat_id: chatId,
        action,
      });
    } catch {
      return false;
    }
  }

  public async setMyCommands(commands: BotCommand[]): Promise<boolean> {
    try {
      await this.request<boolean>("setMyCommands", { commands });
      this.logger.info(`Successfully registered ${commands.length} commands with Telegram.`);
      return true;
    } catch (err: unknown) {
      this.logger.error("Failed to register commands with Telegram:", err);
      return false;
    }
  }

  public async setChatMenuButton(menuButtonType: "commands" | "default" = "commands"): Promise<boolean> {
    try {
      await this.request<boolean>("setChatMenuButton", {
        menu_button: { type: menuButtonType },
      });
      this.logger.info(`Successfully set chat menu button to '${menuButtonType}'.`);
      return true;
    } catch (err: unknown) {
      this.logger.error("Failed to configure chat menu button:", err);
      return false;
    }
  }
}
