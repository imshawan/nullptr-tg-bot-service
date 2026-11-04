export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ModelInfo {
  name: string;
  size?: number;
  modifiedAt?: string;
  family?: string;
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface LlmHealthStatus {
  ok: boolean;
  latencyMs: number;
  availableModelsCount: number;
  error?: string;
}

export interface ILlmProvider {
  /** Returns the active model name */
  getActiveModel(): string;

  /** Updates the active model name */
  setActiveModel(model: string): void;

  /** Returns host endpoint */
  getHost(): string;

  /** Lists all available models */
  listModels(): Promise<ModelInfo[]>;

  /** Streams conversation response */
  chatStream(messages: ChatMessage[], signal?: AbortSignal): AsyncIterable<StreamChunk>;

  /** Performs health check & latency measurement */
  checkHealth(): Promise<LlmHealthStatus>;
}
