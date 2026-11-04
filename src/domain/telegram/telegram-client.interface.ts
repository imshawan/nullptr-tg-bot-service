import {
  TelegramUpdate,
  TelegramMessage,
  SendMessageOptions,
  EditMessageTextOptions,
  SendAudioOptions,
  SendVideoOptions,
  SendDocumentOptions,
  AnswerCallbackQueryOptions,
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

  /** Send an audio file (mp3, m4a, etc.) */
  sendAudio(options: SendAudioOptions): Promise<TelegramMessage>;

  /** Send a video file (mp4, webm, etc.) */
  sendVideo(options: SendVideoOptions): Promise<TelegramMessage>;

  /** Send a general document file */
  sendDocument(options: SendDocumentOptions): Promise<TelegramMessage>;

  /** Acknowledge or display popup for an inline keyboard callback query */
  answerCallbackQuery(options: AnswerCallbackQueryOptions): Promise<boolean>;

  /** Send a chat action, e.g. 'typing', 'upload_video', 'upload_voice' */
  sendChatAction(chatId: number | string, action: ChatAction): Promise<boolean>;

  /** Configure slash command menu in Telegram UI */
  setMyCommands(commands: BotCommand[]): Promise<boolean>;

  /** Configure menu button to open command menu */
  setChatMenuButton(menuButtonType?: "commands" | "default"): Promise<boolean>;
}
