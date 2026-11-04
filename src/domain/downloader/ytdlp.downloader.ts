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

export class YtDlpDownloader implements IDownloaderService {
  private ytdlpBinaryPath: string | null = null;
  private ffmpegBinaryPath: string | null = null;
  private readonly tempDir: string;
  private readonly logger: ILogger;

  constructor(options: {
    customYtDlpPath?: string;
    customFfmpegPath?: string;
    tempDir?: string;
    logger: ILogger;
  }) {
    this.ytdlpBinaryPath = options.customYtDlpPath || null;
    this.ffmpegBinaryPath = options.customFfmpegPath || null;
    this.tempDir = options.tempDir || path.join(os.tmpdir(), "nullptr-downloads");
    this.logger = options.logger.child("YtDlpDownloader");

    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Resolves the pre-bundled yt-dlp binary for the current operating system (win32, linux, darwin).
   * Zero-runtime-download: binary must be bundled inside bin/<platform>/ or available in system PATH.
   */
  public async ensureBinary(): Promise<string> {
    if (this.ytdlpBinaryPath && fs.existsSync(this.ytdlpBinaryPath)) {
      return this.ytdlpBinaryPath;
    }

    const platform = process.platform;
    const isWindows = platform === "win32";
    const binaryName = isWindows ? "yt-dlp.exe" : "yt-dlp";

    // 1. Check pre-bundled platform directory: bin/<platform>/yt-dlp(.exe)
    const bundledPath = path.resolve(process.cwd(), "bin", platform, binaryName);
    if (fs.existsSync(bundledPath)) {
      if (!isWindows) {
        try {
          await fsPromises.chmod(bundledPath, 0o755);
        } catch (err: unknown) {
          this.logger.warn(`Failed to set executable permissions on ${bundledPath}`, { error: String(err) });
        }
      }
      this.ytdlpBinaryPath = bundledPath;
      return bundledPath;
    }

    // 2. Check flat bin/ directory fallback (e.g. bin/yt-dlp.exe)
    const flatBinPath = path.resolve(process.cwd(), "bin", binaryName);
    if (fs.existsSync(flatBinPath)) {
      if (!isWindows) {
        try {
          await fsPromises.chmod(flatBinPath, 0o755);
        } catch (err: unknown) {
          this.logger.warn(`Failed to set executable permissions on ${flatBinPath}`, { error: String(err) });
        }
      }
      this.ytdlpBinaryPath = flatBinPath;
      return flatBinPath;
    }

    // 3. Check system PATH
    const systemPath = await this.findInSystemPath(binaryName);
    if (systemPath) {
      this.ytdlpBinaryPath = systemPath;
      return systemPath;
    }

    // 4. Zero runtime download policy — throw clear diagnostic error
    throw new AppError(
      `yt-dlp binary not found for platform "${platform}". ` +
      `Expected pre-bundled binary at: ${bundledPath}. ` +
      `Runtime downloading is disabled. Please ensure the binary is installed in bin/${platform}/${binaryName} or available in system PATH.`
    );
  }

  /**
   * Resolves the pre-bundled ffmpeg binary for the current operating system (win32, linux, darwin).
   * Zero-runtime-download: binary must be bundled inside bin/<platform>/ or available in system PATH.
   */
  public async ensureFfmpegBinary(): Promise<string | null> {
    if (this.ffmpegBinaryPath && fs.existsSync(this.ffmpegBinaryPath)) {
      return this.ffmpegBinaryPath;
    }

    const platform = process.platform;
    const isWindows = platform === "win32";
    const binaryName = isWindows ? "ffmpeg.exe" : "ffmpeg";

    // 1. Check pre-bundled platform directory: bin/<platform>/ffmpeg(.exe)
    const bundledPath = path.resolve(process.cwd(), "bin", platform, binaryName);
    if (fs.existsSync(bundledPath)) {
      if (!isWindows) {
        try {
          await fsPromises.chmod(bundledPath, 0o755);
        } catch (err: unknown) {
          this.logger.warn(`Failed to set executable permissions on ${bundledPath}`, { error: String(err) });
        }
      }
      this.ffmpegBinaryPath = bundledPath;
      return bundledPath;
    }

    // 2. Check flat bin/ directory fallback (e.g. bin/ffmpeg.exe)
    const flatBinPath = path.resolve(process.cwd(), "bin", binaryName);
    if (fs.existsSync(flatBinPath)) {
      if (!isWindows) {
        try {
          await fsPromises.chmod(flatBinPath, 0o755);
        } catch (err: unknown) {
          this.logger.warn(`Failed to set executable permissions on ${flatBinPath}`, { error: String(err) });
        }
      }
      this.ffmpegBinaryPath = flatBinPath;
      return flatBinPath;
    }

    // 3. Check system PATH
    const systemPath = await this.findInSystemPath(binaryName);
    if (systemPath) {
      this.ffmpegBinaryPath = systemPath;
      return systemPath;
    }

    this.logger.warn(
      `FFmpeg binary not found for platform "${platform}". ` +
      `Expected pre-bundled binary at: ${bundledPath}. Audio extraction and conversions may fail.`
    );
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

  public async getMediaInfo(url: string): Promise<MediaInfo> {
    const binary = await this.ensureBinary();

    return new Promise((resolve, reject) => {
      const args = [
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
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
          return reject(new AppError(`yt-dlp error (${code}): ${stderr || "Failed to fetch media info"}`));
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

  public async download(options: DownloadOptions): Promise<DownloadResult> {
    const binary = await this.ensureBinary();
    const ffmpegBinary = await this.ensureFfmpegBinary();
    const isAudio = AUDIO_FORMATS.includes(options.format);
    const uniquePrefix = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const outputTemplate = path.join(this.tempDir, `${uniquePrefix}_%(title).100B.%(ext)s`);

    const args: string[] = [
      "--no-playlist",
      "--no-warnings",
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
          return reject(new AppError(`Download failed with exit code ${code}: ${stderr.slice(-300)}`));
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
