# nullptr (NullPointer Bot) — Enterprise Telegram LLM & Media Service

**nullptr (NullPointer Bot)** is an enterprise-grade, clean-architecture Telegram bot service written in TypeScript for streaming LLM inference from an Ollama instance deployed on Oracle Cloud (or locally), plus advanced media downloading (8K to 144p video, MP3/M4A/FLAC/WAV audio) powered by `yt-dlp` and a built-in HTTP streaming file server.

---

## 🏛️ Enterprise Architecture & Design Patterns

The project follows **Clean / Hexagonal Architecture** principles, strictly decoupling Telegram communication, LLM inference, media downloading, session storage, and domain business logic:

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
│   ├── downloader/                         # Media Downloader Subsystem (yt-dlp)
│   │   ├── downloader.types.ts             # Formats, qualities & metadata interfaces
│   │   ├── downloader.interface.ts         # IDownloaderService abstraction
│   │   └── ytdlp.downloader.ts             # Binary resolver, metadata extractor & tubesnag cascades
│   ├── llm/
│   │   ├── llm-provider.interface.ts       # ILlmProvider abstraction
│   │   └── ollama.provider.ts              # Concrete Ollama provider (swappable)
│   ├── session/
│   │   ├── session-store.interface.ts      # ISessionStore abstraction
│   │   └── in-memory-session.store.ts      # Session manager (swappable with Redis/DB)
│   └── telegram/
│       ├── telegram.types.ts               # Telegram DTOs, InlineKeyboards & payloads
│       ├── telegram-client.interface.ts    # ITelegramClient interface
│       └── telegram.client.ts              # Resilient Telegram Bot API client
├── services/                               # Application Service Layer
│   ├── commands/                           # Command Pattern Implementation
│   │   ├── command.interface.ts            # ICommandHandler contract & context
│   │   ├── start.command.ts                # /start welcome overview
│   │   ├── help.command.ts                 # /help guide
│   │   ├── download.command.ts             # /download <url> [format]
│   │   ├── models.command.ts               # /models list
│   │   ├── model.command.ts                # /model <name> switch
│   │   ├── clear.command.ts                # /clear context
│   │   └── status.command.ts               # /status latency & health
│   ├── downloader/
│   │   └── downloader-ui.helper.ts         # 2-step hierarchical drilldown menus & session cache
│   ├── file-server/
│   │   ├── file-server.interface.ts        # IFileServerService contract
│   │   └── file-server.service.ts          # HTTP streaming server & HTML5 web player
│   ├── command.registry.ts                 # Command dispatcher & Telegram menu mapper
│   └── bot.service.ts                      # Updates, streaming, link detection, callbacks & delivery
├── utils/                                  # Utilities
│   └── text.utils.ts                       # Message chunking, button URL checks & duration formatting
└── index.ts                                # Composition Root / Dependency Injection
```

---

## ✨ Features

- **Media Downloader (`yt-dlp` & `tubesnag-desktop` Engine)**:
  - Download from YouTube, Twitter/X, Instagram, TikTok, Soundcloud, Reddit, and 1000+ sites.
  - **Direct Link Detection**: Simply paste a link into chat to open an interactive format selector.
  - **2-Step Hierarchical Drilldown UX**: Clean main menu with 1-tap quick buttons (`⚡ Quick Best (MP4)` & `⚡ Quick MP3 (320k)`) plus drilldown submenus for `🎬 All Video Qualities` and `🎵 All Audio Formats & Bitrates`.
  - **All Video Resolutions & Containers**: 8K, 4K (2160p), 1440p (2K), 1080p FHD, 720p HD, 480p SD, 360p, 240p, 144p across MP4, MKV, and WEBM containers.
  - **Vertical Video & YouTube Shorts Optimization**: Resolves effective resolution via `Math.max(w, h)` to prevent vertical videos (e.g. 1080x1920) from downscaling.
  - **Audio Formats & Bitrates**: MP3, M4A, FLAC, WAV, OPUS at 320 kbps, 256 kbps, 192 kbps, 128 kbps, or lossless.
  - **Built-in HTTP File Server & Web Player**: **All video downloads are hosted exclusively via the built-in HTTP file server** (never uploaded into Telegram chat). Features an HTML5 web player with HTTP 206 Byte-Range streaming & scrub support, plus direct download links with automatic 2-hour TTL cleanup.
  - **Telegram Audio Delivery**: Audio downloads $\le 50\text{ MB}$ are delivered directly into chat via `sendAudio`; files $> 50\text{ MB}$ route seamlessly to the HTTP file server.
  - **Pre-Bundled Multi-Platform Binaries**: Pre-bundled standalone executables for both `yt-dlp` and `ffmpeg` across Windows (`bin/win32/`), Linux ARM64 / Oracle Cloud Ampere A1 (`bin/linux-arm64/`), Linux x86_64 (`bin/linux-x64/`), macOS Apple Silicon (`bin/darwin-arm64/`), and macOS Intel (`bin/darwin-x64/`) with zero runtime downloading.
- **AI Streaming with Ollama (Oracle Cloud)**:
  - Real-time token streaming with debounced edits (1200ms) to prevent Telegram 429 rate limits.
  - Continuous "typing..." heartbeat while the model processes complex prompts.
  - Rich Markdown rendering with automatic plain-text fallback on parse errors.
  - Context memory window with automatic reset on model switch.
- **Slash Command Autocomplete**:
  - Automatically configures Telegram's `/` autocomplete popup and native Menu button via `setMyCommands`.
- **Security & Centralized Config**:
  - Authorization guard restricting bot usage to authorized Telegram IDs.
  - Zero direct `process.env` calls outside `src/config/index.ts`.

---

## 📋 Available Commands in nullptr

| Command | Description |
|---|---|
| `/start` | Welcome overview & bot status |
| `/help` | Detailed command reference & guide |
| `/download <url> [format]` | Download video (8k/4k/1080p/720p/etc.) or audio (MP3/M4A/FLAC/etc.) |
| `/models` | List installed Ollama models on Oracle Cloud |
| `/model <name>` | Switch active model for nullptr (e.g. `/model qwen2.5-coder`) |
| `/clear` | Clear nullptr conversation context & memory |
| `/status` | Test Oracle Cloud Ollama latency & server health |

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
SYSTEM_PROMPT="You are nullptr (NullPointer Bot), an expert AI assistant created, authored, and managed by Shawan Mandal (hello@imshawan.dev)."
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
