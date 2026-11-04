import {
  ILlmProvider,
  ChatMessage,
  ModelInfo,
  StreamChunk,
  LlmHealthStatus,
} from "@/domain/llm/llm-provider.interface";
import { LlmProviderError } from "@/core/errors/app-error";
import { ILogger } from "@/core/logger/logger.interface";

interface OllamaTagModel {
  name: string;
  size?: number;
  modified_at?: string;
  details?: {
    family?: string;
  };
}

interface OllamaTagsResponse {
  models?: OllamaTagModel[];
}

interface OllamaChatChunkResponse {
  message?: {
    role: string;
    content: string;
  };
  done?: boolean;
  error?: string;
}

export class OllamaProvider implements ILlmProvider {
  private activeModel: string;
  private readonly host: string;
  private readonly authHeader?: string;
  private readonly systemPrompt?: string;
  private readonly logger: ILogger;

  constructor(options: {
    host: string;
    defaultModel: string;
    authHeader?: string;
    systemPrompt?: string;
    logger: ILogger;
  }) {
    this.host = options.host.replace(/\/+$/, "");
    this.activeModel = options.defaultModel;
    this.authHeader = options.authHeader;
    this.systemPrompt = options.systemPrompt;
    this.logger = options.logger.child("OllamaProvider");
  }

  public getActiveModel(): string {
    return this.activeModel;
  }

  public setActiveModel(model: string): void {
    this.activeModel = model;
    this.logger.info(`Switched active model to: ${model}`);
  }

  public getHost(): string {
    return this.host;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.authHeader) {
      headers["Authorization"] = this.authHeader;
    }
    return headers;
  }

  public async listModels(): Promise<ModelInfo[]> {
    const url = `${this.host}/api/tags`;
    try {
      const res = await fetch(url, { headers: this.getHeaders() });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new LlmProviderError(
          `Failed to list models. HTTP ${res.status}: ${text}`,
          "Ollama",
          res.status
        );
      }
      const data = (await res.json()) as OllamaTagsResponse;
      return (data.models || []).map((m) => ({
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
        family: m.details?.family,
      }));
    } catch (err: unknown) {
      if (err instanceof LlmProviderError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new LlmProviderError(`Network error reaching Ollama at ${url}: ${message}`, "Ollama");
    }
  }

  public async *chatStream(
    messages: ChatMessage[],
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const url = `${this.host}/api/chat`;

    const payloadMessages: ChatMessage[] = [];
    if (this.systemPrompt) {
      payloadMessages.push({ role: "system", content: this.systemPrompt });
    }
    payloadMessages.push(...messages);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.activeModel,
          messages: payloadMessages,
          stream: true,
        }),
        signal,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new LlmProviderError(`Could not initiate stream with Ollama: ${message}`, "Ollama");
    }

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new LlmProviderError(
        `Ollama chat error (HTTP ${res.status}): ${errText || res.statusText}`,
        "Ollama",
        res.status
      );
    }

    const decoder = new TextDecoder();
    let buffer = "";

    // Read stream chunks
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed) as OllamaChatChunkResponse;
          if (parsed.error) {
            throw new LlmProviderError(`Ollama streaming error: ${parsed.error}`, "Ollama");
          }
          if (parsed.message?.content) {
            yield {
              content: parsed.message.content,
              done: parsed.done ?? false,
            };
          }
        } catch (err: unknown) {
          if (err instanceof LlmProviderError) throw err;
          // Ignore incomplete json splits
        }
      }
    }
  }

  public async checkHealth(): Promise<LlmHealthStatus> {
    const startTime = Date.now();
    try {
      const models = await this.listModels();
      const latencyMs = Date.now() - startTime;
      return {
        ok: true,
        latencyMs,
        availableModelsCount: models.length,
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        latencyMs,
        availableModelsCount: 0,
        error: errorMsg,
      };
    }
  }
}
