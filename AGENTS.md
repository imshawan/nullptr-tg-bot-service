# AGENTS.md — Developer Guidelines for nullptr (NullPointer Bot)

This document contains critical architectural rules, conventions, and constraints for AI coding agents and LLMs working on this codebase. Follow these rules strictly to ensure the project remains robust, maintainable, and aligned with its enterprise design.

---

## 🤖 1. Project & Bot Identity
- **Bot Name**: **nullptr (NullPointer Bot)**.
- **Creator, Author & Manager**: **Shawan Mandal** ([hello@imshawan.dev](mailto:hello@imshawan.dev) | [imshawan.dev](https://imshawan.dev)).
- When users ask about who created, authored, or manages nullptr, always state that it was created and is managed by **Shawan Mandal**.
- Always preserve this identity across all user-facing messages, command descriptions, logs, and system prompts.
- Default system persona: `"You are NullPtr, an expert AI assistant created, authored, and managed by Shawan Mandal (hello@imshawan.dev)."`

---

## 🚫 2. Absolute Architectural Invariants (DO NOT VIOLATE)

### A. Zero Direct `process.env` Access
- **Never** read `process.env` directly in any domain, service, command, or utility file.
- All environment variables are validated by `zod` and loaded strictly inside [`src/config/index.ts`](file:///c:/Users/shawa/Desktop/Work/NodeJS/nullptr-tg-bot-service/src/config/index.ts).
- Always use the exported `getConfig` or individual typed getters:
  ```typescript
  import {
    getConfigTelegramToken,
    getConfigOllamaHost,
    getConfigAllowedUserIds,
    getConfigStreamEditIntervalMs,
  } from "@/config";
  ```

### B. No `.js` Extensions & Strict Path Aliases (`@/*`)
- **Never** write `.js` extensions in TypeScript import paths.
- **Never** use deep relative imports (e.g., `../../core/...`).
- Always use `@/*` path aliases pointing to `src/*`:
  ```typescript
  // CORRECT:
  import { ILogger } from "@/core/logger/logger.interface";
  import { ICommandHandler } from "@/services/commands/command.interface";

  // FORBIDDEN:
  import { ILogger } from "../../core/logger/logger.interface.js";
  import { ILogger } from "./logger.interface.js";
  ```

### C. Build Pipeline Invariants
- Dev runner: `npm run dev` (powered by `tsx`).
- Typechecker: `npm run typecheck` (`tsc --noEmit`).
- Production bundler: `npm run build` (`tsc --noEmit && esbuild src/index.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/index.js`).
- Never introduce dependencies or configurations that break `esbuild` or `tsc --noEmit`.

---

## 🏛️ 3. Layer Separation & Design Patterns

1. **`src/config/` (Configuration Layer)**:
   - Holds environment schema, typed getters, and fail-fast validation.
2. **`src/core/` (Cross-Cutting Infrastructure)**:
   - Contains custom typed errors (`AppError`, `TelegramApiError`, `LlmProviderError`), structured logging (`ConsoleLogger`), and common types.
3. **`src/domain/` (Business Entities & Abstractions)**:
   - `domain/llm/`: `ILlmProvider` interface and concrete implementations (`OllamaProvider`).
   - `domain/session/`: `ISessionStore` interface and implementations (`InMemorySessionStore`).
   - `domain/telegram/`: `ITelegramClient` interface, Telegram client wrapper, and typed DTOs.
4. **`src/services/` (Application Services & Command Pattern)**:
   - `services/commands/`: Individual command handlers implementing `ICommandHandler`.
   - `services/command.registry.ts`: Command dispatcher and `setMyCommands` mapper.
   - `services/bot.service.ts`: Long-polling loop, message streaming, rate-limit backoff, and access control.
5. **`src/index.ts` (Composition Root)**:
   - Pure Dependency Injection: instantiates configuration, logger, clients, providers, stores, command handlers, and orchestrator.

---

## ➕ 4. Extension Runbooks

### Adding a New Command
1. Create a class implementing `ICommandHandler` in `src/services/commands/<name>.command.ts`.
2. Define `command`, `description`, and `execute(ctx: CommandContext)`.
3. Register it in `src/index.ts` via `commandRegistry.register(new MyCommand())`.
4. **Do not** add `if (cmd === '/...')` chains inside `BotService`.

### Adding a New LLM Provider
1. Create a class implementing `ILlmProvider` in `src/domain/llm/<provider>.provider.ts`.
2. Implement `listModels()`, `chatStream()`, `checkHealth()`, `getActiveModel()`, and `setActiveModel()`.
3. Add any necessary credentials to `src/config/index.ts`.
4. Inject the new provider into `src/index.ts`.

---

## 🛡️ 5. Required Verification Checklist
Before concluding any modification, you must run:
1. `npm run typecheck` — Must exit with 0 errors.
2. `npm run build` — Must produce `dist/index.js` cleanly in `esbuild`.

---

## 📚 6. Dedicated Skills Catalog
For in-depth procedures and workflows, consult the specialized workspace skills:
- **`telegram-llm-streaming`** (`.agents/skills/telegram-llm-streaming/SKILL.md`): Deep dive into update processing, typing heartbeats, throttled streaming, markdown fallback, and legacy `bot.mjs` mapping.
- **`nullptr-architecture`** (`.agents/skills/nullptr-architecture/SKILL.md`): Architectural layers, path aliases, centralized config, and core invariants.
- **`add-bot-command`** (`.agents/skills/add-bot-command/SKILL.md`): Adding new slash commands and Telegram menu auto-registration.
- **`add-llm-provider`** (`.agents/skills/add-llm-provider/SKILL.md`): Implementing new inference providers (OpenAI, Claude, Gemini, vLLM).
- **`deploy-oracle-cloud`** (`.agents/skills/deploy-oracle-cloud/SKILL.md`): Oracle Cloud deployment, systemd configuration, and firewall troubleshooting.
- **ytdlp-media-download** (.agents/skills/ytdlp-media-download/SKILL.md): yt-dlp media downloader architecture, link detection, format extraction, and Telegram 50MB limits.
