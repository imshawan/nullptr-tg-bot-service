---
name: ytdlp-media-download
description: >-
  Use this skill to understand, debug, or extend nullptr's media download system (powered by yt-dlp),
  including link detection, interactive format selection, audio extraction, Telegram upload constraints,
  and tubesnag-desktop patterns.
---

# nullptr (NullPointer Bot) — yt-dlp Media Downloader Subsystem

nullptr includes a high-performance media downloader built on **yt-dlp**, designed using the proven architecture and format options from the `tubesnag-desktop` project.

---

## 🏛️ Downloader Architecture

```
src/domain/downloader/
├── downloader.types.ts       # FormatType, QualityType, MediaInfo, DownloadResult
├── downloader.interface.ts   # IDownloaderService contract
└── ytdlp.downloader.ts       # Binary resolution, metadata extractor & download runner
```

---

## 🚀 Key Features & Flow

1. **Dual Ingestion Paths**:
   - **Slash Command**: `/download <url> [format]` (or `/dl <url>`).
   - **Direct Link Paste**: Simply sending a valid URL (YouTube, Twitter/X, Instagram, TikTok, Soundcloud, Reddit, etc.) triggers nullptr's interactive downloader.

2. **Interactive Format Selection (Inline Keyboard)**:
   When a link is submitted without an explicit format, nullptr inspects the metadata and renders an interactive Telegram Inline Keyboard:
   - `🎵 Audio (MP3 320k)`
   - `🎵 Audio (M4A)`
   - `🎬 Video (Best MP4)`
   - `🎬 Video (720p)`
   - `🎬 Video (480p)`
   - `❌ Cancel`

3. **Format & Quality Mapping (from tubesnag-desktop)**:
   - **Audio Extraction**: `-x --extract-audio --audio-format mp3 --audio-quality 192K` (or 320K).
   - **Video Quality**: Selects optimal video streams (`bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`) constrained by resolution height (1080p, 720p, 480p, 360p).

4. **Pre-Bundled Multi-Platform Binaries (Zero Runtime Downloads)**:
   - Standalone executables for both **`yt-dlp`** and **`ffmpeg`** are bundled directly inside the project under `bin/`:
     - Windows (`bin/win32/`): `yt-dlp.exe` & `ffmpeg.exe`
     - Linux (`bin/linux/`): `yt-dlp` & `ffmpeg`
     - macOS (`bin/darwin/`): `yt-dlp` & `ffmpeg`
   - At runtime, `YtDlpDownloader.ensureBinary()` and `ensureFfmpegBinary()` detect `process.platform` and automatically resolve the corresponding binaries (`bin/<platform>/yt-dlp[.exe]` and `bin/<platform>/ffmpeg[.exe]`).
   - On Unix (`linux`, `darwin`), permissions are set automatically to `0o755` (`chmod 755`).
   - If custom paths are set in `YTDLP_PATH` / `FFMPEG_PATH` or installed globally in system `PATH`, they serve as flexible overrides.
   - **Zero Runtime Downloads**: Network downloading of binaries at runtime is strictly disabled. All binaries are self-contained within the repository.

5. **Telegram Bot API 50 MB Upload Safeguard**:
   - Telegram Bot API enforces a hard 50 MB file upload limit.
   - If a downloaded video or audio exceeds 50 MB, nullptr detects the size, deletes the temporary file, and politely warns the user with actionable suggestions (e.g. choose MP3 or 480p).
   - For valid files, nullptr uses native `fs.openAsBlob` with `sendAudio` (for MP3/M4A) or `sendVideo` (with streaming support).
   - Temporary files are deleted immediately after upload to maintain disk hygiene.

---

## 🧪 Verification

```bash
npm run typecheck
npm run build
```
