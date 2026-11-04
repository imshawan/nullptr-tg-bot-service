import {
  TelegramUpdate,
  TelegramMessage,
  SendMessageOptions,
  EditMessageTextOptions,
  BotCommand,
  ChatAction,
} from "@/domain/telegram/telegram.types";

export interface ITelegramClient {
  /** Fetch pending updates using long-polling */
  getUpdates(offset: number, timeoutSeconds?: number): Promise<TelegramUpdate[]>;

  /** Send a text message */
  sendMessage(options: SendMessageOptions): Promise<TelegramMessage>;

  /** Edit an existing message text */
  editMessageText(options: EditMessageTextOptions): Promise<TelegramMessage | null>;

  /** Send a chat action, e.g. 'typing' */
  sendChatAction(chatId: number | string, action: ChatAction): Promise<boolean>;

  /** Configure slash command menu in Telegram UI */
  setMyCommands(commands: BotCommand[]): Promise<boolean>;

  /** Configure menu button to open command menu */
  setChatMenuButton(menuButtonType?: "commands" | "default"): Promise<boolean>;
}
