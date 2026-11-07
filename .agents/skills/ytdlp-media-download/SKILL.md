---
name: ytdlp-media-download
description: >-
  Use this skill to understand, debug, or extend nullptr's media download system (powered by yt-dlp),
  including link detection, 2-step format drilldown, audio extraction, HTTP file server video streaming,
  Telegram upload constraints, and tubesnag-desktop patterns.
---

# nullptr (NullPointer Bot) — yt-dlp Media Downloader Subsystem

nullptr includes a high-performance media downloader built on **yt-dlp**, designed using the proven architecture, format cascades, and UX patterns from the `tubesnag-desktop` project.

---

## 🏛️ Downloader Architecture

```
src/domain/downloader/
├── downloader.types.ts       # MediaFormat, MediaQuality, AudioBitrate, VideoResolutionOption, MediaInfo, DownloadResult
├── downloader.interface.ts   # IDownloaderService contract
└── ytdlp.downloader.ts       # Binary resolution, metadata extractor, tubesnag cascades & download runner
src/services/downloader/
└── downloader-ui.helper.ts   # 2-step hierarchical drilldown menus, session cache & dynamic quality buttons
src/services/file-server/
├── file-server.interface.ts  # IFileServerService contract & DownloadEntry
└── file-server.service.ts    # HTTP streaming server with HTML5 web player & direct download
```

---

## 🚀 Key Features & Flow

### 1. Dual Ingestion Paths
- **Slash Command**: `/download <url> [format]` (or `/dl <url>`). Direct formats: e.g. `1080p`, `720p`, `4k`, `mp3`, `320k`.
- **Direct Link Paste**: Simply sending a valid URL (YouTube, Twitter/X, Instagram, TikTok, Soundcloud, Reddit, etc.) triggers nullptr's interactive downloader.

### 2. 2-Step Hierarchical Drilldown UX (Option A with 1-Tap Quick Actions)
When a link is submitted without an explicit format, nullptr probes video metadata and renders a clean 2-step menu that prevents button clutter while offering every possible resolution and format:

- **Main Menu**:
  - `⚡ Quick Best (MP4)`: Instant 1-tap download of the highest available video stream in an MP4 container.
  - `⚡ Quick MP3 (320k)`: Instant 1-tap extraction of MP3 audio at 320 kbps.
  - `🎬 All Video Qualities`: Opens the video resolution drilldown menu.
  - `🎵 All Audio Formats & Bitrates`: Opens the audio format & bitrate drilldown menu.
  - `❌ Cancel`: Dismisses the download session.

- **Video Resolution Submenu (`dl:v_menu`)**:
  - Top action: `🌟 Best Available (Auto)`.
  - Probed resolutions in 2-column grid: `8K UHD`, `4K UHD`, `1440p QHD`, `1080p FHD`, `720p HD`, `480p SD`, `360p`, `240p`, `144p` (with approximate file sizes, e.g. `(~45MB)`).
  - Container toggles: `MP4`, `MKV`, `WEBM` (switches container while retaining chosen quality).
  - Navigation: `⬅️ Back to Menu` and `❌ Cancel`.

- **Audio Submenu (`dl:a_menu`)**:
  - Container toggles: Row 1 (`MP3`, `M4A`, `WAV`), Row 2 (`FLAC`, `OPUS`).
  - Bitrate selectors: `💎 320 kbps (Best)`, `🎶 256 kbps (High)`, `📻 192 kbps (Standard)`, `📁 128 kbps (Compact)` for lossy formats; `🎧 Download Lossless <FORMAT>` for FLAC / WAV.
  - Navigation: `⬅️ Back to Menu` and `❌ Cancel`.

### 3. Tubesnag-Desktop Quality Cascades & Format Alignment
- **Video Cascade Pattern**:
  ```
  bestvideo[ext=mp4][height<=?H]+bestaudio[ext=m4a]/bestvideo[height<=?H]+bestaudio/best[height<=?H]/best
  ```
- **Vertical Video & Shorts Detection**: Resolves effective resolution using `Math.max(w, h)` instead of `height` alone, preventing vertical videos (e.g. 1080x1920 shorts) from erroneously downscaling to 360p or 480p.
- **Fast Web Streaming (`-movflags +faststart`)**: Injected into ffmpeg post-processor flags to shift the MP4 `moov` atom to the beginning of the file, enabling instant seeking and smooth playback before download completes.
- **Format Conversion / Remux**: Uses `--remux-video` when streams are compatible, or `--recode-video` when transcode is required.

### 4. Delivery Routing & Telegram 50 MB Limits
- **All Video Downloads**:
  - **Exclusively served via the built-in HTTP File Server** (`FileServerService`) and **never uploaded directly to Telegram chat**, regardless of file size (including files $\le 50\text{ MB}$).
  - Returns rich message with interactive buttons:
    - `▶️ Stream & Watch`: Opens a responsive HTML5 Web Player with full playback controls, scrub bar, and fullscreen support.
    - `📥 Download (X MB)`: Direct file attachment download via `?dl=1`.
  - Supports HTTP 206 Partial Content (Byte-Range requests) for responsive streaming and seeking.
  - Automatic TTL Cleanup: Files and tokens are purged automatically after 2 hours (120 minutes).
  - Path traversal jail ensures access is restricted strictly to the designated temporary download directory.
- **Audio Downloads**:
  - Files $\le 50\text{ MB}$: Uploaded directly to Telegram chat via `sendAudio` (with audio metadata and title). Deleted immediately after upload to preserve disk hygiene.
  - Files $> 50\text{ MB}$: Served via the built-in HTTP File Server with streaming web player and direct download links.

### 5. Pre-Bundled Multi-Platform Binaries (Zero Runtime Downloads)
Standalone executables for both **`yt-dlp`** and **`ffmpeg`** are bundled directly inside the project under `bin/`, organized by platform and CPU architecture:
- **Windows x64** (`bin/win32/`): `yt-dlp.exe` & `ffmpeg.exe`
- **Linux ARM64 / aarch64** (`bin/linux-arm64/`): `yt-dlp` & `ffmpeg` — for Oracle Cloud Ampere A1, AWS Graviton, Raspberry Pi
- **Linux x86_64** (`bin/linux-x64/`): `yt-dlp` & `ffmpeg` — for AMD/Intel Linux servers
- **macOS Apple Silicon** (`bin/darwin-arm64/`): `yt-dlp` & `ffmpeg`
- **macOS Intel** (`bin/darwin-x64/`): `yt-dlp` & `ffmpeg`
- **Universal Fallback** (`bin/yt-dlp`, `bin/linux/yt-dlp`): Universal multi-platform python3 zipapp

At runtime, `YtDlpDownloader.ensureBinary()` and `ensureFfmpegBinary()` detect `process.platform` and `process.arch`, resolving the matching binary and granting execution permissions (`0o755`). Zero runtime downloading over the network.

### 6. Cookie-Less Datacenter & Cloud IP Bot Challenge Bypass (Oracle Cloud / VPS)
- **YouTube oEmbed Metadata Inspection Fallback**: Link inspection automatically falls back to YouTube's public open oEmbed endpoint (`https://www.youtube.com/oembed`), which has no BotGuard or cookie requirements. Video inspection and format selection buttons never fail even on flagged cloud IPs.
- **Force IPv4 (`--force-ipv4`)**: Prevents yt-dlp from utilizing datacenter IPv6 subnets, which YouTube blocks uniformly across cloud providers.
- **Node.js JavaScript Challenge Solver**: Directly points to the host's active Node.js executable via `--js-runtimes "node:${process.execPath}"` and enriches `PATH` in `spawn()`, ensuring yt-dlp can always execute YouTube's n-challenge and signature deciphering even under restrictive systemd or NVM environments.
- **Multi-Tier Client Strategy**: Prioritizes `web_embedded` and `tv` clients that avoid GVS PO Token constraints.
- **Federated Proxy Stream Fallback**: When direct `yt-dlp` downloading encounters BotGuard on flagged cloud IPs without cookies, nullptr automatically routes to high-availability federated stream instances and downloads/remuxes directly via pre-bundled `ffmpeg`.
- **Tubesnag-Style Error Mapping**: Friendly, human-readable error explanations for bot challenges, private videos, age restrictions, and missing formats.
- **Proxy Support**: Supports `YTDLP_PROXY` in `.env` if an outbound residential/SOCKS5 proxy is configured.

---

## 🧪 Verification

```bash
npm run typecheck
npm run build
```
