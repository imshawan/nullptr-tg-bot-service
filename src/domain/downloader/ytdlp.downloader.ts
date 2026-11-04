import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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
 * 1. default,-tv: Modern yt-dlp dynamic fallback excluding the DRM-flagged TV client.
 * 2. web_safari,web: Safari Web client variant.
 * 3. mweb,android: Mobile web and Android client.
 */
const PLAYER_CLIENT_STRATEGIES = [
  "default,-tv",
  "web_safari,web",
  "mweb,android",
];

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/**
 * Public Cobalt API instances used as primary high-performance fallback.
 */
const COBALT_INSTANCES = [
  "https://cobalt-api.kwiatekm.tokyo",
  "https://api.cobalt.tools",
  "https://cobalt.api.scot",
  "https://cobalt.shdw.link",
  "https://co.eepy.today",
];

/**
 * Public Invidious API instances used as automated fallback to resolve stream URLs
 * when YouTube BotGuard blocks direct VPS IP access without cookies.
 */
const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://invidious.privacydev.net",
  "https://yewtu.be",
  "https://vid.puffyan.us",
  "https://invidious.drgns.space",
  "https://invidious.jing.rocks",
  "https://iv.ggtyler.dev",
  "https://invidious.no-val.org",
];

/**
 * Public Piped API instances used as secondary fallback.
 */
const PIPED_INSTANCES = [
  "https://api.piped.private.coffee",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.drgns.space",
  "https://api.piped.projectsegfau.lt",
];

interface StreamCandidate {
  streamUrl: string;
  title: string;
  source: string;
  directFile?: boolean;
}

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

  public extractYouTubeId(url: string): string | null {
    const match = url.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i
    );
    return match ? match[1] : null;
  }

  private async getOembedInfo(url: string): Promise<MediaInfo> {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl);
    if (!res.ok) {
      throw new AppError(`Could not fetch YouTube video details (HTTP ${res.status})`);
    }
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    const id = this.extractYouTubeId(url) || String(Date.now());
    return {
      id,
      title: data.title || "YouTube Video",
      uploader: data.author_name,
      thumbnail: data.thumbnail_url,
      url,
    };
  }

  public async getMediaInfo(url: string): Promise<MediaInfo> {
    const isYt = this.isYouTubeUrl(url);

    if (isYt) {
      // First try yt-dlp. If blocked by YouTube BotGuard, seamlessly fall back to YouTube oEmbed API
      try {
        return await this.executeGetMediaInfo(url, PLAYER_CLIENT_STRATEGIES[0]);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `yt-dlp metadata inspection challenged on server IP (${errMsg}). Falling back to YouTube oEmbed API...`,
          { url }
        );
        try {
          return await this.getOembedInfo(url);
        } catch (oembedErr: unknown) {
          this.logger.error("YouTube oEmbed metadata fallback also failed:", oembedErr);
          throw err;
        }
      }
    }

    return await this.executeGetMediaInfo(url, PLAYER_CLIENT_STRATEGIES[0]);
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

    // If it's a YouTube URL, try direct yt-dlp first. If BotGuard challenges it, fall back to federated stream proxy.
    if (isYt) {
      try {
        return await this.executeDownload(options, PLAYER_CLIENT_STRATEGIES[0]);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isBot = this.isBotChallenge(errMsg) || errMsg.includes("challenged anonymous access");
        if (isBot) {
          this.logger.warn(
            "yt-dlp challenged by YouTube BotGuard on server IP. Attempting federated stream proxy download fallback...",
            { url: options.url }
          );
          try {
            return await this.downloadViaFederatedStream(options);
          } catch (fedErr: unknown) {
            this.logger.error("Federated stream proxy download also failed:", fedErr);
            throw fedErr;
          }
        }
        throw err;
      }
    }

    return await this.executeDownload(options, PLAYER_CLIENT_STRATEGIES[0]);
  }

  private async downloadViaFederatedStream(options: DownloadOptions): Promise<DownloadResult> {
    const videoId = this.extractYouTubeId(options.url);
    if (!videoId) {
      throw new AppError("Invalid YouTube URL: Could not extract video ID.");
    }

    const isAudio = AUDIO_FORMATS.includes(options.format);
    const ffmpegBinary = await this.ensureFfmpegBinary();

    // 1. First attempt: Cobalt instances (pre-muxed audio/video direct downloads)
    for (const instance of COBALT_INSTANCES) {
      try {
        const candidate = await this.queryCobaltInstance(
          instance,
          options.url,
          options.format,
          options.quality
        );
        if (candidate) {
          const result = await this.tryDownloadCandidate(candidate, options, ffmpegBinary);
          if (result) return result;
        }
      } catch (err: unknown) {
        this.logger.debug(`Cobalt instance ${instance} failed: ${String(err)}`);
      }
    }

    // 2. Second attempt: Invidious instances (proxied formatStreams / adaptiveFormats)
    for (const instance of INVIDIOUS_INSTANCES) {
      try {
        const candidate = await this.queryInvidiousInstance(
          instance,
          videoId,
          isAudio,
          options.quality
        );
        if (candidate) {
          const result = await this.tryDownloadCandidate(candidate, options, ffmpegBinary);
          if (result) return result;
        }
      } catch (err: unknown) {
        this.logger.debug(`Invidious instance ${instance} failed: ${String(err)}`);
      }
    }

    // 3. Third attempt: Piped instances
    for (const instance of PIPED_INSTANCES) {
      try {
        const candidate = await this.queryPipedInstance(
          instance,
          videoId,
          isAudio,
          options.quality
        );
        if (candidate) {
          const result = await this.tryDownloadCandidate(candidate, options, ffmpegBinary);
          if (result) return result;
        }
      } catch (err: unknown) {
        this.logger.debug(`Piped instance ${instance} failed: ${String(err)}`);
      }
    }

    throw new AppError(
      "YouTube challenged anonymous access from this server IP, and federated fallback stream proxies could not complete the download. " +
      "Please try again shortly or configure YTDLP_PROXY in .env to route requests through a residential proxy."
    );
  }

  private async tryDownloadCandidate(
    candidate: StreamCandidate,
    options: DownloadOptions,
    ffmpegBinary: string | null
  ): Promise<DownloadResult | null> {
    const uniquePrefix = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const sanitizedTitle = (candidate.title || "YouTube Media")
      .replace(/[^\w\s.-]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Media";
    const destFilename = `${uniquePrefix}_${sanitizedTitle}.${options.format}`;
    const destPath = path.join(this.tempDir, destFilename);
    const isAudio = AUDIO_FORMATS.includes(options.format);

    this.logger.info(
      `Attempting download via ${candidate.source} for "${candidate.title}" (Format: ${options.format})...`
    );

    try {
      if (candidate.directFile) {
        await this.downloadDirectStream(candidate.streamUrl, destPath);
      } else if (ffmpegBinary) {
        await this.downloadWithFfmpeg(candidate.streamUrl, destPath, options, ffmpegBinary);
      } else {
        await this.downloadDirectStream(candidate.streamUrl, destPath);
      }

      const stats = await fsPromises.stat(destPath);
      if (stats.size < 1000) {
        await fsPromises.unlink(destPath).catch(() => {});
        return null;
      }

      return {
        filePath: destPath,
        filename: destFilename,
        fileSizeBytes: stats.size,
        title: sanitizedTitle,
        format: options.format,
        isAudio,
      };
    } catch (err: unknown) {
      this.logger.debug(`Download candidate attempt failed (${candidate.source}): ${String(err)}`);
      await fsPromises.unlink(destPath).catch(() => {});
      return null;
    }
  }

  private async queryCobaltInstance(
    instance: string,
    url: string,
    format: MediaFormat,
    quality?: MediaQuality
  ): Promise<StreamCandidate | null> {
    const isAudio = AUDIO_FORMATS.includes(format);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const payload = {
      url,
      downloadMode: isAudio ? "audio" : "auto",
      isAudioOnly: isAudio,
      videoQuality: quality === "best" ? "1080" : quality?.replace("p", "") || "720",
      vQuality: quality === "best" ? "1080" : quality?.replace("p", "") || "720",
      audioFormat: format === "m4a" ? "m4a" : format === "wav" ? "wav" : "mp3",
      aFormat: format === "m4a" ? "m4a" : format === "wav" ? "wav" : "mp3",
    };

    try {
      const res = await fetch(`${instance}/`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": BROWSER_USER_AGENT,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) return null;

      const data = (await res.json()) as {
        status?: string;
        url?: string;
        filename?: string;
        picker?: Array<{ url: string }>;
      };

      const streamUrl = data.url || data.picker?.[0]?.url;
      if (!streamUrl) return null;

      return {
        streamUrl,
        title: data.filename || "YouTube Media",
        source: `Cobalt (${new URL(instance).hostname})`,
        directFile: true,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async queryInvidiousInstance(
    instance: string,
    videoId: string,
    isAudio: boolean,
    quality?: MediaQuality
  ): Promise<StreamCandidate | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": BROWSER_USER_AGENT,
        },
        signal: controller.signal,
      });

      if (!res.ok) return null;

      const data = (await res.json()) as {
        title?: string;
        formatStreams?: Array<{
          url: string;
          itag?: string | number;
          qualityLabel?: string;
          resolution?: string;
        }>;
        adaptiveFormats?: Array<{
          url: string;
          itag?: string | number;
          type?: string;
          bitrate?: string | number;
        }>;
      };

      const title = data.title || "YouTube Media";
      let streamUrl: string | null = null;

      if (isAudio && data.adaptiveFormats && data.adaptiveFormats.length > 0) {
        const audioOnly = data.adaptiveFormats.filter(
          (f) => f.type?.includes("audio") || !f.type
        );
        if (audioOnly.length > 0) {
          const sorted = [...audioOnly].sort(
            (a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0)
          );
          const top = sorted[0];
          if (top.url.startsWith("/")) {
            streamUrl = `${instance}${top.url}`;
          } else if (top.url.includes("googlevideo.com")) {
            streamUrl = `${instance}/videoplayback?${new URL(top.url).searchParams.toString()}&local=true`;
          } else {
            streamUrl = top.url;
          }
        }
      } else if (!isAudio && data.formatStreams && data.formatStreams.length > 0) {
        const desiredLabel = quality && quality !== "best" && quality !== "audio" ? quality : "720p";
        const exactMatch = data.formatStreams.find(
          (s) => s.qualityLabel === desiredLabel || s.resolution === desiredLabel
        );
        const selected = exactMatch || data.formatStreams[0];
        if (selected.url.startsWith("/")) {
          streamUrl = `${instance}${selected.url}`;
        } else if (selected.url.includes("googlevideo.com")) {
          streamUrl = `${instance}/videoplayback?${new URL(selected.url).searchParams.toString()}&local=true`;
        } else {
          streamUrl = selected.url;
        }
      }

      if (!streamUrl) {
        const itag = isAudio ? "140" : quality === "360p" ? "18" : "22";
        streamUrl = `${instance}/latest_version?id=${videoId}&itag=${itag}&local=true`;
      }

      return {
        streamUrl,
        title,
        source: `Invidious (${new URL(instance).hostname})`,
        directFile: false,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async queryPipedInstance(
    instance: string,
    videoId: string,
    isAudio: boolean,
    quality?: MediaQuality
  ): Promise<StreamCandidate | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(`${instance}/streams/${videoId}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": BROWSER_USER_AGENT,
        },
        signal: controller.signal,
      });

      if (!res.ok) return null;

      const data = (await res.json()) as {
        title?: string;
        audioStreams?: Array<{ url: string; bitrate?: number }>;
        videoStreams?: Array<{
          url: string;
          quality?: string;
          height?: number;
          videoOnly?: boolean;
        }>;
      };

      const title = data.title || "YouTube Media";
      let streamUrl: string | null = null;

      if (isAudio && data.audioStreams && data.audioStreams.length > 0) {
        const sorted = [...data.audioStreams].sort(
          (a, b) => (b.bitrate || 0) - (a.bitrate || 0)
        );
        streamUrl = sorted[0].url;
      } else if (!isAudio && data.videoStreams && data.videoStreams.length > 0) {
        const combined = data.videoStreams.filter((s) => !s.videoOnly);
        const targetList = combined.length > 0 ? combined : data.videoStreams;
        const targetHeight = quality && quality !== "best" && quality !== "audio"
          ? parseInt(quality.replace("p", ""), 10) || 720
          : 720;
        const matching = targetList.find((s) => s.height === targetHeight);
        if (matching) {
          streamUrl = matching.url;
        } else {
          const sorted = [...targetList].sort(
            (a, b) => (b.height || 0) - (a.height || 0)
          );
          streamUrl = sorted[0].url;
        }
      }

      if (!streamUrl) return null;

      return {
        streamUrl,
        title,
        source: `Piped (${new URL(instance).hostname})`,
        directFile: false,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async downloadWithFfmpeg(
    streamUrl: string,
    outputPath: string,
    options: DownloadOptions,
    ffmpegBinary: string
  ): Promise<void> {
    const isAudio = AUDIO_FORMATS.includes(options.format);
    const args: string[] = [
      "-y",
      "-user_agent",
      BROWSER_USER_AGENT,
      "-i",
      streamUrl,
    ];

    if (isAudio) {
      if (options.format === "mp3") {
        args.push("-vn", "-c:a", "libmp3lame", "-b:a", `${options.audioBitrate || "192"}k`, outputPath);
      } else if (options.format === "m4a") {
        args.push("-vn", "-c:a", "aac", "-b:a", `${options.audioBitrate || "192"}k`, outputPath);
      } else if (options.format === "wav") {
        args.push("-vn", outputPath);
      } else {
        args.push("-vn", "-b:a", `${options.audioBitrate || "192"}k`, outputPath);
      }
    } else {
      args.push("-c", "copy", outputPath);
    }

    try {
      await this.runFfmpegProcess(ffmpegBinary, args);
    } catch (err: unknown) {
      if (!isAudio && options.format === "mp4") {
        this.logger.warn("FFmpeg stream copy failed. Retrying with libx264/aac transcode...", {
          error: String(err),
        });
        const fallbackArgs = [
          "-y",
          "-user_agent",
          BROWSER_USER_AGENT,
          "-i",
          streamUrl,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          outputPath,
        ];
        await this.runFfmpegProcess(ffmpegBinary, fallbackArgs);
      } else {
        throw err;
      }
    }
  }

  private runFfmpegProcess(ffmpegBinary: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegBinary, args);
      let stderr = "";

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new AppError(`FFmpeg failed with exit code ${code}: ${stderr.slice(-300)}`));
        }
      });

      proc.on("error", (err) => {
        reject(new AppError(`Could not launch FFmpeg: ${err.message}`));
      });
    });
  }

  private async downloadDirectStream(streamUrl: string, outputPath: string): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(streamUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          Accept: "*/*",
        },
      });

      if (!res.ok) {
        throw new AppError(`Direct stream download failed (HTTP ${res.status})`);
      }
      if (!res.body) {
        throw new AppError("No response body received from stream source.");
      }

      const fileStream = fs.createWriteStream(outputPath);
      await pipeline(Readable.fromWeb(res.body as any), fileStream);
    } finally {
      clearTimeout(timeoutId);
    }
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
