# nullptr (NullPointer Bot) — Enterprise Telegram LLM Service

**nullptr (NullPointer Bot)** is an enterprise-grade, clean-architecture Telegram bot service written in TypeScript for streaming LLM inference from an Ollama instance deployed on Oracle Cloud (or locally).

---

## 🏛️ Enterprise Architecture & Design Patterns

The project follows **Clean / Hexagonal Architecture** principles, strictly decoupling Telegram communication, LLM inference, session storage, and domain business logic:

```
src/
├── config/                                 # Centralized Configuration System
│   └── index.ts                            # Zod schema, env object, getConfig & typed getters
├── core/                                   # Cross-Cutting Infrastructure
│   ├── errors/
│   │   └── app-error.ts                    # Custom typed domain errors
│   ├── logger/
│   │   ├── logger.interface.ts             # ILogger interface
│   │   └── console-logger.ts               # Structured logger with levels & timestamps
│   └── types/
│       └── common.types.ts                 # Shared system types & lifecycle interfaces
├── domain/                                 # Domain Core
│   ├── llm/
│   │   ├── llm-provider.interface.ts       # ILlmProvider abstraction
│   │   └── ollama.provider.ts              # Concrete Ollama provider (swappable)
│   ├── session/
│   │   ├── session-store.interface.ts      # ISessionStore abstraction
│   │   └── in-memory-session.store.ts      # Session manager (swappable with Redis/DB)
│   └── telegram/
│       ├── telegram.types.ts               # Telegram DTOs & payloads
│       ├── telegram-client.interface.ts    # ITelegramClient interface
│       └── telegram.client.ts              # Resilient Telegram Bot API client
├── services/                               # Application Service Layer
│   ├── commands/                           # Command Pattern Implementation
│   │   ├── command.interface.ts            # ICommandHandler contract & context
│   │   ├── start.command.ts                # /start & /help
│   │   ├── models.command.ts               # /models
│   │   ├── model.command.ts                # /model <name>
│   │   ├── clear.command.ts                # /clear
│   │   └── status.command.ts               # /status
│   ├── command.registry.ts                 # Command dispatcher & Telegram menu mapper
│   └── bot.service.ts                      # Update processing, streaming & throttling
├── utils/                                  # Utilities
│   └── text.utils.ts                       # Message chunking & formatting
└── index.ts                                # Composition Root / Dependency Injection
```

### Applied Patterns & Standards
- **nullptr Identity & Persona**: Configured with a default persona and explicit branding across all slash commands, Telegram autocomplete menus, status reports, and logs.
- **Centralized Configuration Guard**: `process.env` is never accessed directly by application code. All environment access goes through `@/config` via `env`, `getConfig(key)`, or dedicated typed getters (`getConfigTelegramToken()`, `getConfigOllamaHost()`, etc.).
- **Clean Path Aliases (`@/*`)**: All imports use absolute path aliases (e.g. `import { ILogger } from "@/core/logger/logger.interface"`) without brittle relative navigation (`../../`) or explicit `.js` extensions.
- **Dependency Inversion / Inversion of Control**: Components rely on interfaces (`ILlmProvider`, `ITelegramClient`, `ISessionStore`, `ILogger`), not concrete implementations.
- **Command Pattern**: Every slash command (`/models`, `/model`, `/clear`, etc.) is an isolated class implementing `ICommandHandler`.
- **Repository / Store Abstraction**: `ISessionStore` manages chat history. Swappable with Redis or SQL without touching the service layer.
- **Provider Pattern**: `ILlmProvider` abstracts inference. Swapping Ollama for OpenAI, Anthropic, or vLLM requires only adding a new provider class.

---

## 📋 Available Commands in nullptr

| Command | Description |
|---|---|
| `/start` | Start nullptr (NullPointer Bot) & show info |
| `/help` | Show available nullptr commands |
| `/models` | List installed Ollama models for nullptr |
| `/model <name>` | Switch active model for nullptr (e.g. `/model qwen2.5-coder`) |
| `/clear` | Clear nullptr conversation context & memory |
| `/status` | Check nullptr & Oracle Cloud connectivity |

---

## 🚀 Getting Started

### 1. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Edit `.env`:
```env
TELEGRAM_TOKEN=your_telegram_bot_token_here
ALLOWED_USER_ID=your_numeric_telegram_id
OLLAMA_HOST=http://<ORACLE_CLOUD_IP>:11434
OLLAMA_MODEL=qwen2.5-coder:latest
SYSTEM_PROMPT="You are NullPtr, an expert AI assistant."
LOG_LEVEL=info
```

### 2. Available Scripts

```bash
# 1. Run in development mode with live reload & path alias support
npm run dev

# 2. Run TypeScript type checks
npm run typecheck

# 3. Fast bundle build to dist/index.js (resolves @/* aliases)
npm run build

# 4. Start production build
npm start
```

---

## ☁️ Oracle Cloud Deployment Tips

If your Ollama instance is running on an Oracle Cloud Compute instance:

1. **Listen on `0.0.0.0`**: On the Oracle VM, add `Environment="OLLAMA_HOST=0.0.0.0:11434"` to `/etc/systemd/system/ollama.service.d/environment.conf`, then reload and restart Ollama:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ollama
   ```
2. **Oracle VCN Security List**: In Oracle Cloud Console > *Virtual Cloud Networks* > *Security Lists*, add an Ingress Rule allowing TCP port `11434`.
3. **Ubuntu iptables**: Allow ingress on the host:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 11434 -j ACCEPT
   sudo netfilter-persistent save
   ```

---

## 🛠️ Production 24/7 Service (systemd)

1. Build the project:
   ```bash
   npm run build
   ```
2. Copy the unit file:
   ```bash
   sudo cp nullptr-tg-bot.service /etc/systemd/system/
   ```
3. Enable and start:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now nullptr-tg-bot
   ```
4. View logs:
   ```bash
   journalctl -u nullptr-tg-bot -f
   ```

---

## 👨‍💻 Author & Maintainer

**nullptr (NullPointer Bot)** is authored, created, and maintained by:
- **Shawan Mandal**
- Email: [hello@imshawan.dev](mailto:hello@imshawan.dev)
- Website: [imshawan.dev](https://imshawan.dev)
- GitHub: [@imshawan](https://github.com/imshawan)
