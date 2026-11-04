import { ISessionStore } from "@/domain/session/session-store.interface";
import { ChatMessage } from "@/domain/llm/llm-provider.interface";

export class InMemorySessionStore implements ISessionStore {
  private readonly history = new Map<number, ChatMessage[]>();

  constructor(private readonly maxHistoryMessages: number = 20) {}

  public async getHistory(chatId: number): Promise<ChatMessage[]> {
    const list = this.history.get(chatId);
    return list ? [...list] : [];
  }

  public async appendMessage(chatId: number, message: ChatMessage): Promise<void> {
    const current = this.history.get(chatId) || [];
    current.push(message);

    while (current.length > this.maxHistoryMessages) {
      current.shift();
    }

    this.history.set(chatId, current);
  }

  public async clearHistory(chatId: number): Promise<void> {
    this.history.delete(chatId);
  }

  public async getMessageCount(chatId: number): Promise<number> {
    return (this.history.get(chatId) || []).length;
  }
}
