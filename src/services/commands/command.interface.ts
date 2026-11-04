import { ITelegramClient } from "@/domain/telegram/telegram-client.interface";
import { ILlmProvider } from "@/domain/llm/llm-provider.interface";
import { ISessionStore } from "@/domain/session/session-store.interface";
import { ILogger } from "@/core/logger/logger.interface";

export interface CommandContext {
  chatId: number;
  senderId?: number;
  rawText: string;
  args: string[];
  telegram: ITelegramClient;
  llm: ILlmProvider;
  sessionStore: ISessionStore;
  logger: ILogger;
}

export interface ICommandHandler {
  /** Command name without slash, in lowercase (e.g., 'start') */
  readonly command: string;

  /** Description displayed in Telegram's autocomplete menu */
  readonly description: string;

  /** Optional alternative command triggers */
  readonly aliases?: string[];

  /** Command execution logic */
  execute(ctx: CommandContext): Promise<void>;
}
