import { ChatMessage } from "@/domain/llm/llm-provider.interface";

export interface ISessionStore {
  /** Retrieves conversation history for a chat */
  getHistory(chatId: number): Promise<ChatMessage[]>;

  /** Appends a message to the chat history, automatically maintaining maximum limits */
  appendMessage(chatId: number, message: ChatMessage): Promise<void>;

  /** Clears conversation history for a chat */
  clearHistory(chatId: number): Promise<void>;

  /** Returns history length for metrics/status */
  getMessageCount(chatId: number): Promise<number>;
}
