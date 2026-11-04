---
name: add-llm-provider
description: >-
  Use this skill when adding or replacing LLM inference providers (e.g. OpenAI, Anthropic Claude,
  Gemini, vLLM) in nullptr (NullPointer Bot). Enforces the ILlmProvider interface.
---

# Adding an LLM Provider to nullptr (NullPointer Bot)

nullptr abstracts all LLM communication behind the `ILlmProvider` interface in `src/domain/llm/llm-provider.interface.ts`.

---

## 📐 Step 1: Review `ILlmProvider` Contract

Your provider must satisfy this interface:

```typescript
export interface ILlmProvider {
  getActiveModel(): string;
  setActiveModel(model: string): void;
  getHost(): string;
  listModels(): Promise<ModelInfo[]>;
  chatStream(messages: ChatMessage[], signal?: AbortSignal): AsyncIterable<StreamChunk>;
  checkHealth(): Promise<LlmHealthStatus>;
}
```

---

## 🛠️ Step 2: Implement the Provider

Create `src/domain/llm/<provider-name>.provider.ts`:

```typescript
import {
  ILlmProvider,
  ChatMessage,
  ModelInfo,
  StreamChunk,
  LlmHealthStatus,
} from "@/domain/llm/llm-provider.interface";
import { LlmProviderError } from "@/core/errors/app-error";
import { ILogger } from "@/core/logger/logger.interface";

export class CustomLlmProvider implements ILlmProvider {
  private activeModel: string;
  private readonly logger: ILogger;

  constructor(options: { defaultModel: string; apiKey?: string; logger: ILogger }) {
    this.activeModel = options.defaultModel;
    this.logger = options.logger.child("CustomLlmProvider");
  }

  public getActiveModel(): string {
    return this.activeModel;
  }

  public setActiveModel(model: string): void {
    this.activeModel = model;
  }

  public getHost(): string {
    return "https://api.custom-llm.com";
  }

  public async listModels(): Promise<ModelInfo[]> {
    // Return model list
    return [{ name: this.activeModel }];
  }

  public async *chatStream(
    messages: ChatMessage[],
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    // Yield tokens as they stream in:
    // yield { content: token, done: false };
  }

  public async checkHealth(): Promise<LlmHealthStatus> {
    const start = Date.now();
    try {
      await this.listModels();
      return { ok: true, latencyMs: Date.now() - start, availableModelsCount: 1 };
    } catch (err: unknown) {
      return { ok: false, latencyMs: Date.now() - start, availableModelsCount: 0, error: String(err) };
    }
  }
}
```

---

## ⚙️ Step 3: Add Config Keys (if needed)

In `src/config/index.ts`, add any required API keys to `envSchema` and export dedicated getters. **Never use `process.env` directly!**

---

## 🔌 Step 4: Wire in `src/index.ts`

Replace or parameterize the provider instantiation in `src/index.ts`:

```typescript
const llmProvider = new CustomLlmProvider({
  defaultModel: getConfig("OPENAI_MODEL") || "gpt-4o",
  apiKey: getConfigOpenaiApiKey(),
  logger,
});
```

`BotService`, `CommandRegistry`, and all slash commands will work immediately without any modification!

---

## 🧪 Step 5: Verification

```bash
npm run typecheck
npm run build
```
