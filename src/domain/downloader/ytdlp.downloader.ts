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
} from "@/domain/downloader/downloader.types";
import { ILogger } from "@/core/logger/logger.interface";
import { AppError } from "@/core/errors/app-error";

const AUDIO_FORMATS: MediaFormat[] = ["mp3", "m4a", "wav"];

const QUALITY_MAP: Record<MediaQuality, string> = {
  best: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
  "1080p": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720][ext=mp4]+bestaudio/best[ext=mp4]/best",
  "720p": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480][ext=mp4]+bestaudio/best[ext=mp4]/best",
  "480p": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
  "360p": "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
  audio: "bestaudio/best",
};

/**
 * YouTube player client strategies in order of bypass reliability on datacenter/VPS networks without cookies.
 * 1. web_embedded: External embed player, bypasses GVS PO Token requirements on most videos.
 * 2. mweb: Mobile web client with tv_embedded fallback.
 * 3. default: Built-in dynamic fallback sequence.
 */
const PLAYER_CLIENT_STRATEGIES = [
  "web_embedded,tv,visionos,android,web",
  "mweb,web_embedded,tv_embedded",
  "default,web_embedded",
];

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
    return match ? match[0] : null;
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

  private getProcessEnv(): NodeJS.ProcessEnv {
    const nodeDir = path.dirname(process.execPath);
    const currentPath = process.env.PATH || "";
    return {
      ...process.env,
      PATH: currentPath ? `${nodeDir}${path.delimiter}${currentPath}` : nodeDir,
    };
  }

  private buildBaseArgs(playerClients: string = PLAYER_CLIENT_STRATEGIES[0]): string[] {
    const args: string[] = [
      "--no-warnings",
      "--no-playlist",
      "--socket-timeout",
      "30",
      // Force IPv4 to prevent datacenter IPv6 subnet blocks from YouTube
      "--force-ipv4",
      // Leverage the host's active Node.js runtime to execute YouTube's JS challenges
      "--js-runtimes",
      `node:${process.execPath}`,
      "--extractor-args",
      `youtube:player_client=${playerClients}`,
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

  public async getMediaInfo(url: string): Promise<MediaInfo> {
    const isYt = this.isYouTubeUrl(url);
    const strategies = isYt ? PLAYER_CLIENT_STRATEGIES : [PLAYER_CLIENT_STRATEGIES[0]];

    let lastError: Error | null = null;
    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];
      try {
        return await this.executeGetMediaInfo(url, strategy);
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isBot = lastError.message.includes("challenged anonymous access");
        if (isBot && i < strategies.length - 1) {
          this.logger.warn(
            `YouTube bot challenge encountered with strategy "${strategy}". Retrying with fallback "${strategies[i + 1]}"...`,
            { url }
          );
          continue;
        }
        throw lastError;
      }
    }

    throw lastError || new AppError("Failed to inspect media link.");
  }

  private async executeGetMediaInfo(url: string, clientStrategy: string): Promise<MediaInfo> {
    const binary = await this.ensureBinary();

    return new Promise((resolve, reject) => {
      const args = [
        ...this.buildBaseArgs(clientStrategy),
        "--dump-single-json",
        "--skip-download",
        url,
      ];

      const proc = spawn(binary, args, { env: this.getProcessEnv() });
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
          const info: MediaInfo = {
            id: data.id || String(Date.now()),
            title: data.title || "Untitled Media",
            uploader: data.uploader || data.channel,
            duration: data.duration,
            thumbnail: data.thumbnail,
            url,
            approxFilesize: data.filesize || data.filesize_approx,
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

  public async download(options: DownloadOptions): Promise<DownloadResult> {
    const isYt = this.isYouTubeUrl(options.url);
    const strategies = isYt ? PLAYER_CLIENT_STRATEGIES : [PLAYER_CLIENT_STRATEGIES[0]];

    let lastError: Error | null = null;
    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];
      try {
        return await this.executeDownload(options, strategy);
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isBot = lastError.message.includes("challenged anonymous access");
        if (isBot && i < strategies.length - 1) {
          this.logger.warn(
            `YouTube bot challenge encountered during download with strategy "${strategy}". Retrying with fallback "${strategies[i + 1]}"...`,
            { url: options.url }
          );
          continue;
        }
        throw lastError;
      }
    }

    throw lastError || new AppError("Failed to download media.");
  }

  private async executeDownload(options: DownloadOptions, clientStrategy: string): Promise<DownloadResult> {
    const binary = await this.ensureBinary();
    const ffmpegBinary = await this.ensureFfmpegBinary();
    const isAudio = AUDIO_FORMATS.includes(options.format);
    const uniquePrefix = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const outputTemplate = path.join(this.tempDir, `${uniquePrefix}_%(title).100B.%(ext)s`);

    const args: string[] = [
      ...this.buildBaseArgs(clientStrategy),
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
      const formatStr = QUALITY_MAP[quality] || QUALITY_MAP.best;
      args.push("-f", formatStr);

      if (options.format !== "mp4") {
        args.push("--recode-video", options.format);
      }
    }

    args.push(options.url);

    this.logger.info(`Starting download for: ${options.url} (Format: ${options.format}, Strategy: ${clientStrategy})`);

    return new Promise((resolve, reject) => {
      const proc = spawn(binary, args, { env: this.getProcessEnv() });
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

          const filePath = path.join(this.tempDir, matchedFile);
          const stats = await fsPromises.stat(filePath);

          // Strip the unique prefix for user-facing title
          const cleanTitle = matchedFile
            .replace(new RegExp(`^${uniquePrefix}_`), "")
            .replace(/\.[^/.]+$/, "");

          resolve({
            filePath,
            filename: matchedFile,
            fileSizeBytes: stats.size,
            title: cleanTitle,
            format: options.format,
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
}
