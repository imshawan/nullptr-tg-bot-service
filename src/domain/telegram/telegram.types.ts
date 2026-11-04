export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_markup?: InlineKeyboardMarkup;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  inline_message_id?: string;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: {
    migrate_to_chat_id?: number;
    retry_after?: number;
  };
}

export interface BotCommand {
  command: string;
  description: string;
}

export type ChatAction =
  | "typing"
  | "upload_photo"
  | "record_video"
  | "upload_video"
  | "record_voice"
  | "upload_voice"
  | "upload_document"
  | "choose_sticker"
  | "find_location";

export interface SendMessageOptions {
  chat_id: number | string;
  text: string;
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  reply_to_message_id?: number;
  reply_markup?: InlineKeyboardMarkup;
}

export interface EditMessageTextOptions {
  chat_id: number | string;
  message_id: number;
  text: string;
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  reply_markup?: InlineKeyboardMarkup;
}

export interface SendAudioOptions {
  chat_id: number | string;
  filePath: string;
  caption?: string;
  title?: string;
  performer?: string;
  duration?: number;
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  reply_to_message_id?: number;
}

export interface SendVideoOptions {
  chat_id: number | string;
  filePath: string;
  caption?: string;
  duration?: number;
  width?: number;
  height?: number;
  supports_streaming?: boolean;
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  reply_to_message_id?: number;
}

export interface SendDocumentOptions {
  chat_id: number | string;
  filePath: string;
  caption?: string;
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  reply_to_message_id?: number;
}

export interface AnswerCallbackQueryOptions {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
  url?: string;
}
