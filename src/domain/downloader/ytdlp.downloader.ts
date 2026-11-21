import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { IDownloaderService } from "@/domain/downloader/downloader.interface";
import {
  MediaInfo,
  DownloadOptions,
  DownloadResult,
  MediaFormat,
  MediaQuality,
  VideoResolutionOption,
} from "@/domain/downloader/downloader.types";
import { ILogger } from "@/core/logger/logger.interface";
import { AppError } from "@/core/errors/app-error";

const AUDIO_FORMATS: MediaFormat[] = ["mp3", "m4a", "wav", "flac", "aac", "opus"];

const QUALITY_MAP: Record<MediaQuality, string> = {
  best: "bestvideo+bestaudio/best",
  "8k": "bestvideo[height<=?4320]+bestaudio/bestvideo[width<=?4320]+bestaudio/bestvideo+bestaudio/best",
  "4k": "bestvideo[height<=?2160]+bestaudio/bestvideo[width<=?2160]+bestaudio/bestvideo+bestaudio/best",
  "2160p": "bestvideo[height<=?2160]+bestaudio/bestvideo[width<=?2160]+bestaudio/bestvideo+bestaudio/best",
  "1440p": "bestvideo[height<=?1440]+bestaudio/bestvideo[width<=?1440]+bestaudio/bestvideo+bestaudio/best",
  "1080p": "bestvideo[height<=?1080]+bestaudio/bestvideo[width<=?1080]+bestaudio/bestvideo+bestaudio/best",
  "720p": "bestvideo[height<=?720]+bestaudio/bestvideo[width<=?720]+bestaudio/bestvideo+bestaudio/best",
  "480p": "bestvideo[height<=?480]+bestaudio/bestvideo[width<=?480]+bestaudio/bestvideo+bestaudio/best",
  "360p": "bestvideo[height<=?360]+bestaudio/bestvideo[width<=?360]+bestaudio/bestvideo+bestaudio/best",
  "240p": "bestvideo[height<=?240]+bestaudio/bestvideo[width<=?240]+bestaudio/bestvideo+bestaudio/best",
  "144p": "bestvideo[height<=?144]+bestaudio/bestvideo[width<=?144]+bestaudio/bestvideo+bestaudio/best",
  audio: "bestaudio/best",
  unknown: "bestvideo+bestaudio/best",
};

export class YtDlpDownloader implements IDownloaderService {
  private ytdlpBinaryPath: string | null = null;
  private ffmpegBinaryPath: string | null = null;
  private readonly proxyUrl?: string;
  private readonly tempDir: string;
  private readonly logger: ILogger;

  constructor(options: {
    customYtDlpPath?: string;
    customFfmpegPath?: string;
    customProxy?: string;
    tempDir?: string;
    logger: ILogger;
  }) {
    this.ytdlpBinaryPath = options.customYtDlpPath || null;
    this.ffmpegBinaryPath = options.customFfmpegPath || null;
    this.proxyUrl = options.customProxy;
    this.tempDir = options.tempDir || path.join(os.tmpdir(), "nullptr-downloads");
    this.logger = options.logger.child("YtDlpDownloader");

    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Resolves the pre-bundled yt-dlp binary for the current operating system and architecture.
   * Zero-runtime-download: binary must be bundled inside bin/ or available in system PATH.
   */
  public async ensureBinary(): Promise<string> {
    if (this.ytdlpBinaryPath && fs.existsSync(this.ytdlpBinaryPath)) {
      return this.ytdlpBinaryPath;
    }

    const platform = process.platform;
    const arch = process.arch;
    const isWindows = platform === "win32";
    const binaryName = isWindows ? "yt-dlp.exe" : "yt-dlp";
    const archAlias = arch === "arm64" ? "aarch64" : arch;

    const candidates = [
      // 1. Architecture-specific platform dir (e.g. bin/linux-arm64/yt-dlp, bin/linux-x64/yt-dlp)
      path.resolve(process.cwd(), "bin", `${platform}-${arch}`, binaryName),
      // 2. Architecture suffix within platform dir (e.g. bin/linux/yt-dlp_aarch64)
      path.resolve(process.cwd(), "bin", platform, `${binaryName}_${archAlias}`),
      path.resolve(process.cwd(), "bin", platform, `${binaryName}_${arch}`),
      // 3. Platform directory (e.g. bin/win32/yt-dlp.exe, bin/linux/yt-dlp)
      path.resolve(process.cwd(), "bin", platform, binaryName),
      // 4. Flat bin directory (e.g. bin/yt-dlp)
      path.resolve(process.cwd(), "bin", binaryName),
    ];

    const resolved = await this.resolveCandidateBinary(candidates);
    if (resolved) {
      this.logger.debug(`Resolved yt-dlp binary at: ${resolved}`);
      this.ytdlpBinaryPath = resolved;
      return resolved;
    }

    // 5. Check system PATH
    const systemPath = await this.findInSystemPath(binaryName);
    if (systemPath) {
      this.logger.debug(`Resolved yt-dlp binary from system PATH: ${systemPath}`);
      this.ytdlpBinaryPath = systemPath;
      return systemPath;
    }

    // Zero runtime download policy — throw clear diagnostic error
    throw new AppError(
      `yt-dlp binary not found for platform "${platform}" (${arch}). ` +
      `Expected pre-bundled binary in bin/${platform}-${arch}/${binaryName} or available in system PATH. ` +
      `Runtime downloading is disabled.`
    );
  }

  /**
   * Resolves the pre-bundled ffmpeg binary for the current operating system and architecture.
   * Zero-runtime-download: binary must be bundled inside bin/ or available in system PATH.
   */
  public async ensureFfmpegBinary(): Promise<string | null> {
    if (this.ffmpegBinaryPath && fs.existsSync(this.ffmpegBinaryPath)) {
      return this.ffmpegBinaryPath;
    }

    const platform = process.platform;
    const arch = process.arch;
    const isWindows = platform === "win32";
    const binaryName = isWindows ? "ffmpeg.exe" : "ffmpeg";
    const archAlias = arch === "arm64" ? "aarch64" : arch;

    const candidates = [
      // 1. Architecture-specific platform dir (e.g. bin/linux-arm64/ffmpeg, bin/linux-x64/ffmpeg)
      path.resolve(process.cwd(), "bin", `${platform}-${arch}`, binaryName),
      // 2. Architecture suffix within platform dir (e.g. bin/linux/ffmpeg_aarch64)
      path.resolve(process.cwd(), "bin", platform, `${binaryName}_${archAlias}`),
      path.resolve(process.cwd(), "bin", platform, `${binaryName}_${arch}`),
      // 3. Platform directory (e.g. bin/win32/ffmpeg.exe, bin/linux/ffmpeg)
      path.resolve(process.cwd(), "bin", platform, binaryName),
      // 4. Flat bin directory (e.g. bin/ffmpeg)
      path.resolve(process.cwd(), "bin", binaryName),
    ];

    const resolved = await this.resolveCandidateBinary(candidates);
    if (resolved) {
      this.logger.debug(`Resolved FFmpeg binary at: ${resolved}`);
      this.ffmpegBinaryPath = resolved;
      return resolved;
    }

    // 5. Check system PATH
    const systemPath = await this.findInSystemPath(binaryName);
    if (systemPath) {
      this.logger.debug(`Resolved FFmpeg binary from system PATH: ${systemPath}`);
      this.ffmpegBinaryPath = systemPath;
      return systemPath;
    }

    this.logger.warn(
      `FFmpeg binary not found for platform "${platform}" (${arch}). Audio extraction and conversions may fail.`
    );
    return null;
  }

  private async resolveCandidateBinary(candidates: string[]): Promise<string | null> {
    const isWindows = process.platform === "win32";

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        if (!isWindows) {
          try {
            await fsPromises.chmod(candidate, 0o755);
          } catch (err: unknown) {
            this.logger.warn(`Failed to set executable permissions on ${candidate}`, {
              error: String(err),
            });
          }
        }
        return candidate;
      }
    }

    return null;
  }

  private async findInSystemPath(binary: string): Promise<string | null> {
    return new Promise((resolve) => {
      const checkCmd = process.platform === "win32" ? "where" : "which";
      const proc = spawn(checkCmd, [binary]);
      let stdout = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.on("close", (code) => {
        if (code === 0 && stdout.trim()) {
          const firstLine = stdout.trim().split(/\r?\n/)[0];
          resolve(firstLine);
        } else {
          resolve(null);
        }
      });

      proc.on("error", () => resolve(null));
    });
  }

  public isSupportedUrl(text: string): boolean {
    const url = this.extractUrl(text);
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return ["http:", "https:"].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  public extractUrl(text: string): string | null {
    const match = text.match(/https?:\/\/[^\s<>"'{}|\\^`[\]]+/i);
    return match ? this.cleanMediaUrl(match[0]) : null;
  }

  /**
   * Cleans media URLs by stripping tracking parameters (e.g. ?igsh=..., ?utm_source=...)
   * which can cause Instagram and other extractors to fail with empty responses.
   */
  public cleanMediaUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (
        parsed.hostname.includes("instagram.com") ||
        parsed.hostname.includes("instagr.am")
      ) {
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString();
      }
      return url;
    } catch {
      return url;
    }
  }

  public isInstagramUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.includes("instagram.com") ||
        parsed.hostname.includes("instagr.am")
      );
    } catch {
      return false;
    }
  }

  public isYouTubeUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.includes("youtube.com") ||
        parsed.hostname.includes("youtu.be")
      );
    } catch {
      return false;
    }
  }

  private buildBaseArgs(): string[] {
    const args: string[] = [
      "--no-warnings",
      "--no-playlist",
      "--socket-timeout",
      "30",
      // Force IPv4 to prevent datacenter IPv6 subnet blocks
      "--force-ipv4",
      // Allow yt-dlp to fetch required EJS challenge solving components dynamically
      "--remote-components",
      "ejs:npm,ejs:github",
      // Leverage the host's active Node.js runtime to execute YouTube's JS challenges
      "--js-runtimes",
      "node",
    ];

    if (this.proxyUrl) {
      args.push("--proxy", this.proxyUrl);
    }

    return args;
  }

  private isBotChallenge(stderr: string): boolean {
    const lower = stderr.toLowerCase();
    return (
      lower.includes("sign in to confirm you’re not a bot") ||
      lower.includes("sign in to confirm you're not a bot") ||
      lower.includes("not a bot")
    );
  }

  private formatYtDlpError(code: number | null, stderr: string): AppError {
    const trimmed = stderr.trim();
    const lower = trimmed.toLowerCase();

    if (this.isBotChallenge(stderr)) {
      return new AppError(
        "YouTube challenged anonymous access from this server IP. Please try again in a few moments, or configure YTDLP_PROXY in .env to route requests through a residential proxy."
      );
    }

    if (lower.includes("empty media response")) {
      return new AppError(
        "Instagram sent an empty media response. The post or reel may be private, age-restricted, or temporarily restricted from anonymous access."
      );
    }

    if (lower.includes("requested format is not available")) {
      return new AppError("The requested format or quality is not available for this media.");
    }
    if (lower.includes("video unavailable")) {
      return new AppError("This video is unavailable or has been removed.");
    }
    if (lower.includes("private video")) {
      return new AppError("This video is private and cannot be downloaded.");
    }
    if (lower.includes("age-restricted")) {
      return new AppError("This video is age-restricted and requires an authenticated session.");
    }
    if (lower.includes("http error 403")) {
      return new AppError("Access forbidden (HTTP 403). The server was blocked from accessing this media stream.");
    }
    if (lower.includes("http error 404")) {
      return new AppError("Media not found (HTTP 404).");
    }
    if (lower.includes("connection refused") || lower.includes("unreachable network")) {
      return new AppError("Network error: Could not reach the media host.");
    }

    const codeStr = code !== null ? String(code) : "unknown";
    return new AppError(`yt-dlp error (${codeStr}): ${trimmed || "Failed to process media request"}`);
  }

  private async cleanupPrefix(prefix: string): Promise<void> {
    try {
      const files = await fsPromises.readdir(this.tempDir);
      const matches = files.filter((f) => f.startsWith(prefix));
      await Promise.all(
        matches.map((f) => fsPromises.unlink(path.join(this.tempDir, f)).catch(() => {}))
      );
    } catch {
      // Ignore cleanup error
    }
  }

  public async getMediaInfo(rawUrl: string): Promise<MediaInfo> {
    const url = this.cleanMediaUrl(rawUrl);
    const isIg = this.isInstagramUrl(url);

    try {
      return await this.executeGetMediaInfo(url);
    } catch (err: unknown) {
      if (isIg && err instanceof Error && err.message.toLowerCase().includes("empty media response")) {
        this.logger.warn(
          `Instagram returned empty media response for ${url}. Retrying with ios app_id extractor arg...`
        );
        try {
          return await this.executeGetMediaInfo(url, ["--extractor-args", "instagram:app_id=ios"]);
        } catch {
          throw err;
        }
      }
      throw err;
    }
  }

  private async executeGetMediaInfo(url: string, extraArgs: string[] = []): Promise<MediaInfo> {
    const binary = await this.ensureBinary();

    return new Promise((resolve, reject) => {
      const args = [
        ...this.buildBaseArgs(),
        ...extraArgs,
        "--dump-single-json",
        "--skip-download",
        url,
      ];

      const proc = spawn(binary, args);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          return reject(this.formatYtDlpError(code, stderr));
        }

        try {
          const data = JSON.parse(stdout);
          const availableVideoQualities = this.extractAvailableQualities(data);
          const info: MediaInfo = {
            id: data.id || String(Date.now()),
            title: data.title || "Untitled Media",
            uploader: data.uploader || data.channel,
            duration: data.duration,
            thumbnail: data.thumbnail,
            url,
            approxFilesize: data.filesize || data.filesize_approx,
            availableVideoQualities,
          };
          resolve(info);
        } catch (err: unknown) {
          reject(new AppError(`Failed to parse media metadata: ${String(err)}`));
        }
      });

      proc.on("error", (err) => {
        reject(new AppError(`Could not launch yt-dlp: ${err.message}`));
      });
    });
  }

  /**
   * Resolves quality type using main dimension threshold (widescreen width or portrait height),
   * mirroring tubesnag-desktop's resolveQualityByResolution.
   */
  public resolveQualityByResolution(w?: number, h?: number): MediaQuality | null {
    if (!w && !h) return null;
    const mainDim = Math.max(w || 0, h || 0);

    if (mainDim >= 7680) return "8k";
    if (mainDim >= 3840) return "4k";
    if (mainDim >= 2560) return "1440p";
    if (mainDim >= 1920) return "1080p";
    if (mainDim >= 1280) return "720p";
    if (mainDim >= 854) return "480p";
    if (mainDim >= 640) return "360p";
    if (mainDim >= 426) return "240p";
    if (mainDim >= 256) return "144p";

    return null;
  }

  private extractAvailableQualities(data: any): VideoResolutionOption[] {
    const ORDERED_QUALITIES: Array<{ quality: MediaQuality; label: string; minDim: number }> = [
      { quality: "8k", label: "8K Ultra HD", minDim: 7680 },
      { quality: "4k", label: "4K (2160p)", minDim: 3840 },
      { quality: "1440p", label: "2K (1440p)", minDim: 2560 },
      { quality: "1080p", label: "1080p FHD", minDim: 1920 },
      { quality: "720p", label: "720p HD", minDim: 1280 },
      { quality: "480p", label: "480p SD", minDim: 854 },
      { quality: "360p", label: "360p", minDim: 640 },
      { quality: "240p", label: "240p", minDim: 426 },
      { quality: "144p", label: "144p", minDim: 256 },
    ];

    if (!data || !Array.isArray(data.formats) || data.formats.length === 0) {
      return [
        { quality: "1080p", label: "1080p FHD" },
        { quality: "720p", label: "720p HD" },
        { quality: "480p", label: "480p SD" },
        { quality: "360p", label: "360p" },
      ];
    }

    // Audio stream approximate size
    const audioStream = data.formats.find(
      (f: any) => f.vcodec === "none" && f.acodec !== "none" && (f.filesize || f.filesize_approx)
    );
    const audioSize = audioStream
      ? (audioStream.filesize || audioStream.filesize_approx || 0)
      : (data.duration ? Math.round((128 * 1000 / 8) * data.duration) : 0);

    const videoFormats: any[] = data.formats.filter(
      (f: any) => f.vcodec !== "none" && (typeof f.height === "number" || typeof f.width === "number")
    );

    if (videoFormats.length === 0) {
      return [
        { quality: "720p", label: "720p HD" },
        { quality: "480p", label: "480p SD" },
      ];
    }

    const maxDim = Math.max(...videoFormats.map((f: any) => Math.max(f.width || 0, f.height || 0)));
    const results: VideoResolutionOption[] = [];

    for (const item of ORDERED_QUALITIES) {
      const matches = videoFormats.filter((f: any) => {
        const q = this.resolveQualityByResolution(f.width, f.height);
        return q === item.quality;
      });

      if (matches.length === 0 && maxDim < item.minDim) {
        continue;
      }

      let approxSizeBytes: number | undefined;

      if (matches.length > 0) {
        const bestMatch = matches.find((f: any) => f.ext === "mp4") || matches[0];
        const vSize = bestMatch.filesize || bestMatch.filesize_approx ||
          (bestMatch.tbr && data.duration ? Math.round((bestMatch.tbr * 1000 / 8) * data.duration) : undefined);

        if (vSize) {
          approxSizeBytes = bestMatch.acodec === "none" ? vSize + audioSize : vSize;
        }
      }

      if (!approxSizeBytes && data.duration) {
        const estimatedBitrates: Record<string, number> = {
          "8k": 25000,
          "4k": 12000,
          "1440p": 6000,
          "1080p": 3000,
          "720p": 1500,
          "480p": 800,
          "360p": 500,
          "240p": 300,
          "144p": 150,
        };
        const br = estimatedBitrates[item.quality] || 1000;
        approxSizeBytes = Math.round((br * 1000 / 8) * data.duration);
      }

      results.push({
        quality: item.quality,
        label: item.label,
        approxSizeBytes,
      });
    }

    return results.length > 0 ? results : [
      { quality: "1080p", label: "1080p FHD" },
      { quality: "720p", label: "720p HD" },
      { quality: "480p", label: "480p SD" },
      { quality: "360p", label: "360p" },
    ];
  }

  public async download(options: DownloadOptions): Promise<DownloadResult> {
    const url = this.cleanMediaUrl(options.url);
    const cleanOptions = { ...options, url };
    const isIg = this.isInstagramUrl(url);

    try {
      return await this.executeDownload(cleanOptions);
    } catch (err: unknown) {
      if (isIg && err instanceof Error && err.message.toLowerCase().includes("empty media response")) {
        this.logger.warn(
          `Instagram returned empty media response on download for ${url}. Retrying with ios app_id...`
        );
        try {
          return await this.executeDownload(cleanOptions, ["--extractor-args", "instagram:app_id=ios"]);
        } catch {
          throw err;
        }
      }
      throw err;
    }
  }

  private async executeDownload(
    options: DownloadOptions,
    extraArgs: string[] = []
  ): Promise<DownloadResult> {
    const binary = await this.ensureBinary();
    const ffmpegBinary = await this.ensureFfmpegBinary();
    const isAudio = AUDIO_FORMATS.includes(options.format);
    const uniquePrefix = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const outputTemplate = path.join(this.tempDir, `${uniquePrefix}_%(title).100B.%(ext)s`);

    const args: string[] = [
      ...this.buildBaseArgs(),
      ...extraArgs,
      "-o",
      outputTemplate,
    ];

    if (ffmpegBinary) {
      args.push("--ffmpeg-location", ffmpegBinary);
    } else if (isAudio || options.format !== "mp4") {
      this.logger.warn(
        `FFmpeg binary not detected. Audio extraction (${options.format}) or recoding might fail if not in PATH.`
      );
    }

    if (isAudio) {
      args.push(
        "-f",
        "bestaudio/best",
        "-x",
        "--audio-format",
        options.format,
        "--audio-quality",
        `${options.audioBitrate || "192"}K`
      );
    } else {
      const quality = options.quality || "best";
      let formatStr = QUALITY_MAP[quality] || QUALITY_MAP.best;
      if (options.format !== "mp4") {
        formatStr = formatStr.replaceAll("mp4", options.format);
      }
      args.push("-f", formatStr);

      if (options.format === "mp4") {
        const isHighResQuality =
          quality === "4k" ||
          quality === "2160p" ||
          quality === "1440p" ||
          quality === "8k" ||
          quality === "best";

        if (isHighResQuality) {
          // Prioritize resolution first for 4K/1440p/8K/best so true high-res streams are downloaded
          args.push("-S", "res,vcodec:h264,acodec:m4a");
        } else {
          // Prioritize universally compatible H.264 for standard <= 1080p tiers
          args.push("-S", "vcodec:h264,res,acodec:m4a");
        }
      }

      // Force output container and ensure proper merging of separate video+audio streams
      args.push("--merge-output-format", options.format);

      // Remux into target container format (e.g. mp4) so all media players can decode it
      args.push("--remux-video", options.format);

      // Faststart: shift moov atom to beginning of file for instant web streaming and playback
      if (ffmpegBinary && options.format === "mp4") {
        args.push(
          "--postprocessor-args",
          "Merger:-movflags +faststart",
          "--postprocessor-args",
          "VideoRemuxer:-movflags +faststart"
        );
      }
    }

    args.push(options.url);

    this.logger.info(`Starting download for: ${options.url} (Format: ${options.format})`);

    return new Promise((resolve, reject) => {
      const proc = spawn(binary, args);
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        // Progress parsing
        const match = text.match(/\[download\]\s+([\d.]+)%/);
        if (match && options.onProgress) {
          const percent = parseFloat(match[1]);
          options.onProgress(percent);
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", async (code) => {
        if (code !== 0) {
          await this.cleanupPrefix(uniquePrefix);
          return reject(this.formatYtDlpError(code, stderr));
        }

        try {
          // Find the generated file matching our unique prefix
          const files = await fsPromises.readdir(this.tempDir);
          const matchedFile = files.find((f) => f.startsWith(uniquePrefix));

          if (!matchedFile) {
            return reject(new AppError("Downloaded file could not be found in output directory."));
          }

          let filePath = path.join(this.tempDir, matchedFile);

          // If MP4 video and FFmpeg is available, sanitize container:
          // 1. Probes video stream codec (transcodes AV1/VP9 to H.264 if source had no AVC)
          // 2. Flattens fragmented MP4s (fMP4/moof boxes from Instagram/DASH) into standard MP4
          // 3. Guarantees faststart (+faststart) moov atom at byte 0 for instant seeking & playback
          if (!isAudio && options.format === "mp4" && ffmpegBinary) {
            filePath = await this.ensureMp4Playable(filePath, ffmpegBinary);
          }

          const stats = await fsPromises.stat(filePath);
          const finalFilename = path.basename(filePath);
          const finalFormat = (path.extname(filePath).replace(/^\./, "") || options.format) as MediaFormat;

          // Strip the unique prefix for user-facing title
          const cleanTitle = finalFilename
            .replace(new RegExp(`^${uniquePrefix}_`), "")
            .replace(/\.[^/.]+$/, "");

          resolve({
            filePath,
            filename: finalFilename,
            fileSizeBytes: stats.size,
            title: cleanTitle,
            format: finalFormat,
            isAudio,
          });
        } catch (err: unknown) {
          reject(new AppError(`Error resolving downloaded file: ${String(err)}`));
        }
      });

      proc.on("error", (err) => {
        reject(new AppError(`Failed to run download process: ${err.message}`));
      });
    });
  }

  /**
   * Sanitizes and verifies that an MP4 video file is universally playable across
   * Apple QuickTime, Safari, iOS WebKit, Chrome HTML5 video, and Telegram:
   * 1. Inspects stream codecs using FFmpeg probe.
   * 2. If the video codec is incompatible with native MP4 players (e.g. AV1, VP9),
   *    transcodes video to H.264 (libx264) with AAC audio.
   * 3. If already H.264/compatible, performs an instant stream copy (-c copy)
   *    with -movflags +faststart to flatten any fragmented MP4 (fMP4/moof) boxes
   *    and place the moov atom at byte 0 for instant playback.
   */
  private async ensureMp4Playable(filePath: string, ffmpegBinary: string): Promise<string> {
    const fixedPath = `${filePath}.fixed.mp4`;

    try {
      // Step 1: Probe streams using FFmpeg
      const probeOutput = await new Promise<string>((resolve) => {
        const proc = spawn(ffmpegBinary, ["-i", filePath]);
        let stderr = "";
        proc.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        proc.on("close", () => resolve(stderr));
        proc.on("error", () => resolve(""));
      });

      const isAv1 = /Video:\s*(av01|av1)/i.test(probeOutput);
      const isVp9 = /Video:\s*(vp09|vp9)/i.test(probeOutput);

      // Detect resolution from FFmpeg stream probe (e.g. 3840x2160, 2560x1440, 1920x1080)
      let isHighRes = false;
      const resMatch = probeOutput.match(/Video:[^\n]+?[,\s](\d{3,5})x(\d{3,5})/i);
      if (resMatch) {
        const width = parseInt(resMatch[1], 10);
        const height = parseInt(resMatch[2], 10);
        if (!isNaN(width) && !isNaN(height)) {
          isHighRes = Math.max(width, height) > 1920;
        }
      } else {
        // Fallback: look for dimension >= 2000 (e.g. 2160, 2560, 3840, 7680)
        isHighRes = /(?:[2-9]\d{3}|[1-9]\d{4})x|x(?:[2-9]\d{3}|[1-9]\d{4})/i.test(probeOutput);
      }

      // Case 1: High-res videos (4K / 1440p / 8K) with VP9 or AV1 codecs.
      // Apple devices (QuickTime, Safari, iOS AVPlayer) reject VP9/AV1 inside MP4 containers.
      // However, modern Safari (macOS 11+, iOS 14+), Chrome, Firefox, and VLC natively play VP9/AV1
      // when encapsulated in a WebM container with Opus audio.
      // Remuxing video with -c:v copy and converting audio to Opus with -c:a libopus takes <0.05s,
      // consumes zero CPU for video, and delivers 100% playable 4K.
      if (isHighRes && (isVp9 || isAv1)) {
        const webmPath = filePath.replace(/\.[^/.]+$/, ".webm");
        this.logger.info(
          `Remuxing high-res ${isAv1 ? "AV1" : "VP9"} stream into WebM container for web playback: ${webmPath}`
        );
        const ffmpegArgs = [
          "-y",
          "-i",
          filePath,
          "-c:v",
          "copy",
          "-c:a",
          "libopus",
          "-b:a",
          "160k",
          webmPath,
        ];
        const success = await new Promise<boolean>((resolve) => {
          const proc = spawn(ffmpegBinary, ffmpegArgs);
          proc.stderr.resume();
          proc.stdout.resume();
          proc.on("close", (code) => resolve(code === 0));
          proc.on("error", () => resolve(false));
        });

        if (success && fs.existsSync(webmPath)) {
          const webmStats = await fsPromises.stat(webmPath);
          if (webmStats.size > 1024) {
            await fsPromises.unlink(filePath).catch(() => {});
            this.logger.debug(`Successfully remuxed high-res media to WebM: ${webmPath}`);
            return webmPath;
          }
        }
      }

      // Case 2: Standard <= 1080p video with non-native codec (AV1 or VP9) in MP4.
      // Transcode to universally playable H.264 (libx264) with standard 8-bit YUV420P color space.
      if ((isAv1 || isVp9) && !isHighRes) {
        this.logger.info(
          `Detected non-native codec in MP4 (${isAv1 ? "AV1" : "VP9"}). Transcoding to H.264 for playback compatibility: ${filePath}`
        );
        const ffmpegArgs = [
          "-y",
          "-i",
          filePath,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "22",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-movflags",
          "+faststart",
          fixedPath,
        ];

        const success = await new Promise<boolean>((resolve) => {
          const proc = spawn(ffmpegBinary, ffmpegArgs);
          proc.stderr.resume();
          proc.stdout.resume();
          proc.on("close", (code) => resolve(code === 0));
          proc.on("error", (err) => {
            this.logger.warn(`FFmpeg transcode error: ${err.message}`);
            resolve(false);
          });
        });

        if (success && fs.existsSync(fixedPath)) {
          const fixedStats = await fsPromises.stat(fixedPath);
          if (fixedStats.size > 1024) {
            await fsPromises.unlink(filePath);
            await fsPromises.rename(fixedPath, filePath);
            this.logger.debug(`Successfully transcoded and flattened MP4: ${filePath}`);
            return filePath;
          }
        }
      }

      // Case 3: Native H.264 video (YouTube 1080p, Instagram, Twitter, etc.).
      // Fast remux: stream copy takes < 0.2s, flattens fragmented MP4 (fMP4/moof) and shifts moov atom to byte 0.
      if (!isAv1 && !isVp9) {
        const ffmpegArgs = [
          "-y",
          "-i",
          filePath,
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          fixedPath,
        ];

        const success = await new Promise<boolean>((resolve) => {
          const proc = spawn(ffmpegBinary, ffmpegArgs);
          proc.stderr.resume();
          proc.stdout.resume();
          proc.on("close", (code) => resolve(code === 0));
          proc.on("error", (err) => {
            this.logger.warn(`FFmpeg faststart error: ${err.message}`);
            resolve(false);
          });
        });

        if (success && fs.existsSync(fixedPath)) {
          const fixedStats = await fsPromises.stat(fixedPath);
          if (fixedStats.size > 1024) {
            await fsPromises.unlink(filePath);
            await fsPromises.rename(fixedPath, filePath);
            this.logger.debug(`Successfully verified and flattened MP4: ${filePath}`);
            return filePath;
          }
        }
      }
    } catch (err: unknown) {
      this.logger.warn(`Failed to post-process MP4 container, keeping original file: ${String(err)}`);
    } finally {
      await fsPromises.unlink(fixedPath).catch(() => {});
    }

    return filePath;
  }
}
