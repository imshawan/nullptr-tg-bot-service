import http from "node:http";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { BOT_NAME } from "@/config";
import { IFileServerService, DownloadEntry } from "./file-server.interface";
import { ILogger } from "@/core/logger/logger.interface";
import { renderPlayerView } from "@/views/player.view";
import { renderErrorView } from "@/views/error.view";

const MIME_MAP: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

export class FileServerService implements IFileServerService {
  private readonly port: number;
  private configuredBaseUrl?: string;
  private resolvedBaseUrl?: string;
  private readonly defaultTtlMinutes: number;
  private readonly allowedDir: string;
  private readonly registryPath: string;
  private readonly logger: ILogger;
  private server: http.Server | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly entries = new Map<string, DownloadEntry>();
  private isSavingRegistry = false;
  private pendingSave = false;

  constructor(options: {
    port: number;
    baseUrl?: string;
    defaultTtlMinutes?: number;
    allowedDir?: string;
    logger: ILogger;
  }) {
    this.port = options.port;
    this.configuredBaseUrl = options.baseUrl?.replace(/\/+$/, "");
    this.defaultTtlMinutes = options.defaultTtlMinutes || 120;
    this.allowedDir = path.resolve(options.allowedDir || path.join(os.tmpdir(), "nullptr-downloads"));
    this.registryPath = path.join(this.allowedDir, ".registry.json");
    this.logger = options.logger.child("FileServer");

    if (!fs.existsSync(this.allowedDir)) {
      fs.mkdirSync(this.allowedDir, { recursive: true });
    }
  }

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

    // 1. Reconcile persisted download registry and purge stale/orphaned files on disk from prior sessions
    await this.loadRegistry();
    await this.scavengeOrphanedDiskFiles();

    // 2. Resolve base URL (configured or auto-detected public IP)
    if (this.configuredBaseUrl) {
      this.resolvedBaseUrl = this.configuredBaseUrl;
    } else {
      const publicIp = await this.resolvePublicIp();
      this.resolvedBaseUrl = publicIp ? `http://${publicIp}:${this.port}` : `http://localhost:${this.port}`;
    }

    this.server = http.createServer((req, res) => this.handleHttpRequest(req, res));

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, "0.0.0.0", () => {
        this.logger.info(`[${BOT_NAME}] File Server active on port ${this.port}. Base URL: ${this.resolvedBaseUrl}`);
        resolve();
      });

      this.server!.on("error", (err) => {
        this.logger.error(`[${BOT_NAME}] Failed to bind File Server on port ${this.port}:`, err);
        reject(err);
      });
    });

    // 3. Start background cleanup timer (runs every 10 minutes to purge expired links and disk fragments)
    this.cleanupTimer = setInterval(async () => {
      await this.purgeExpiredFiles();
      await this.scavengeOrphanedDiskFiles();
    }, 10 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  public async stop(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    await this.saveRegistry().catch(() => {});

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          this.logger.info(`[${BOT_NAME}] File Server stopped.`);
          this.server = null;
          resolve();
        });
      });
    }
  }

  public isReady(): boolean {
    return this.server !== null && this.server.listening;
  }

  public getBaseUrl(): string {
    return this.resolvedBaseUrl || `http://localhost:${this.port}`;
  }

  public async registerDownload(
    filePath: string,
    filename: string,
    title?: string,
    ttlMinutes?: number
  ): Promise<string> {
    const stats = await fsPromises.stat(filePath);
    const token = crypto.randomBytes(16).toString("hex");
    const ext = path.extname(filename).toLowerCase();
    const mimeType = MIME_MAP[ext] || "application/octet-stream";
    const durationMs = (ttlMinutes || this.defaultTtlMinutes) * 60 * 1000;
    const now = Date.now();

    const userFriendlyFilename = (title ? `${title}${ext}` : filename).replace(/^dl_\d+_[a-z0-9]+_/, "");

    const entry: DownloadEntry = {
      token,
      filePath,
      filename: userFriendlyFilename,
      title: title || filename,
      fileSizeBytes: stats.size,
      mimeType,
      createdAt: now,
      expiresAt: now + durationMs,
    };

    this.entries.set(token, entry);
    await this.saveRegistry();

    // Sanitize filename for URL path to prevent breaking Telegram Markdown links:
    // Strip temporary prefix, replace all brackets, parentheses, spaces, and unsafe symbols with underscores.
    const cleanBase = filename
      .replace(/^dl_\d+_[a-z0-9]+_/, "")
      .replace(/[/\\?%*:|"<>()[\]#\s]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    const safeFilename = encodeURIComponent(
      (cleanBase || "media").endsWith(ext) ? cleanBase : `${cleanBase}${ext}`
    ).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

    const downloadUrl = `${this.getBaseUrl()}/dl/${token}/${safeFilename}`;

    this.logger.info(
      `Registered direct download for "${filename}" (${(stats.size / (1024 * 1024)).toFixed(1)} MB). URL: ${downloadUrl}`
    );

    return downloadUrl;
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const rawUrl = req.url || "/";
    const parsedUrl = new URL(rawUrl, "http://localhost");
    const pathname = parsedUrl.pathname;

    // Health check endpoint
    if (pathname === "/health" || pathname === "/ping") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          service: "nullptr-fileserver",
          activeDownloads: this.entries.size,
          uptime: process.uptime(),
        })
      );
      return;
    }

    // Direct download endpoint: /dl/:token/:filename
    const match = pathname.match(/^\/dl\/([a-f0-9]{32})\/(.+)$/i);
    if (!match) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`404 Not Found - ${BOT_NAME} File Server`);
      return;
    }

    const token = match[1];
    const entry = this.entries.get(token);

    if (!entry) {
      const html = renderErrorView({
        statusCode: 404,
        title: "Download Link Not Found",
        message: "This download link does not exist or has expired.",
        icon: "🔍",
      });
      res.writeHead(404, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html, "utf-8"),
      });
      res.end(html);
      return;
    }

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(token);
      await this.saveRegistry().catch(() => {});
      await fsPromises.unlink(entry.filePath).catch(() => {});
      const html = renderErrorView({
        statusCode: 410,
        title: "Download Link Expired",
        message: "This download link has reached its 2-hour expiration window and the temporary file has been purged.",
        icon: "⏱️",
      });
      res.writeHead(410, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html, "utf-8"),
      });
      res.end(html);
      return;
    }

    // Security check: Path Traversal Jail. File must reside strictly inside the allowed downloads directory.
    const resolvedPath = path.resolve(entry.filePath);
    if (!resolvedPath.startsWith(this.allowedDir)) {
      this.logger.warn(`Security alert: Attempted access outside allowed directory: ${resolvedPath}`);
      const html = renderErrorView({
        statusCode: 403,
        title: "Access Denied",
        message: "Access to the requested file path is forbidden.",
        icon: "🚫",
      });
      res.writeHead(403, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html, "utf-8"),
      });
      res.end(html);
      return;
    }

    if (!fs.existsSync(entry.filePath)) {
      this.entries.delete(token);
      await this.saveRegistry().catch(() => {});
      const html = renderErrorView({
        statusCode: 404,
        title: "File Not Found",
        message: "The requested file no longer exists on the server.",
        icon: "📁",
      });
      res.writeHead(404, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html, "utf-8"),
      });
      res.end(html);
      return;
    }

    // Standard HTTP security headers (nosniff enabled; CSP relaxed for native media streaming in Safari)
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Accept-Ranges", "bytes");

    const fileSizeBytes = entry.fileSizeBytes;
    const isDownload = parsedUrl.searchParams.get("dl") === "1" || parsedUrl.searchParams.get("download") === "1";
    const wantsStream = parsedUrl.searchParams.get("stream") === "1";
    const rangeHeader = req.headers.range;

    // Check if the client is a browser navigating directly to the URL wanting an HTML web player page
    const wantsHtml =
      !isDownload &&
      !wantsStream &&
      !rangeHeader &&
      Boolean(req.headers.accept?.includes("text/html"));

    if (wantsHtml) {
      const streamUrl = `${pathname}?stream=1`;
      const directDownloadUrl = `${pathname}?dl=1`;

      const html = renderPlayerView({
        title: entry.title,
        filename: entry.filename,
        fileSizeBytes: entry.fileSizeBytes,
        mimeType: entry.mimeType,
        streamUrl,
        directDownloadUrl,
        expiresAt: entry.expiresAt,
      });

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html, "utf-8"),
        "Cache-Control": "no-cache",
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(html);
      return;
    }

    const dispositionType = isDownload ? "attachment" : "inline";
    const asciiFilename = entry.filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
    const encodedFilename = encodeURIComponent(entry.filename);
    const contentDisposition = `${dispositionType}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;

    // Critical for Safari / iOS:
    // If client requested download (?dl=1), Content-Type MUST be application/octet-stream.
    // If Content-Type is video/mp4, Safari's WebKit media engine intercepts the request and launches AVPlayer,
    // completely ignoring Content-Disposition: attachment and preventing the user from saving the file.
    const responseContentType = isDownload ? "application/octet-stream" : entry.mimeType;

    // Support HTTP Range requests (HTTP 206 Partial Content) strictly required by Safari & iOS
    let start = 0;
    let end = fileSizeBytes - 1;
    let isRange = false;

    if (rangeHeader && rangeHeader.startsWith("bytes=")) {
      isRange = true;
      const rawRange = rangeHeader.substring(6).trim();
      const hyphenIdx = rawRange.indexOf("-");

      if (hyphenIdx !== -1) {
        const startStr = rawRange.substring(0, hyphenIdx).trim();
        const endStr = rawRange.substring(hyphenIdx + 1).trim();

        if (startStr === "" && endStr !== "") {
          // Suffix range (e.g. bytes=-500000: last 500 KB, common in Safari to locate moov atom)
          const suffix = parseInt(endStr, 10);
          if (!isNaN(suffix) && suffix > 0) {
            start = Math.max(0, fileSizeBytes - suffix);
            end = fileSizeBytes - 1;
          }
        } else if (startStr !== "" && endStr === "") {
          // Open-ended range (e.g. bytes=1024-)
          const s = parseInt(startStr, 10);
          if (!isNaN(s)) {
            start = Math.min(s, fileSizeBytes - 1);
            end = fileSizeBytes - 1;
          }
        } else if (startStr !== "" && endStr !== "") {
          // Explicit chunk range (e.g. bytes=0-1 probe from Safari)
          const s = parseInt(startStr, 10);
          const e = parseInt(endStr, 10);
          if (!isNaN(s) && !isNaN(e)) {
            start = s;
            end = Math.min(e, fileSizeBytes - 1);
          }
        }
      }
    }

    if (isRange) {
      if (start >= fileSizeBytes || start > end || start < 0) {
        res.writeHead(416, {
          "Content-Range": `bytes */${fileSizeBytes}`,
        });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSizeBytes}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": responseContentType,
        "Content-Disposition": contentDisposition,
        "Cache-Control": "public, max-age=3600",
      });

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      const fileStream = fs.createReadStream(entry.filePath, { start, end });
      fileStream.pipe(res);
      fileStream.on("error", (err) => {
        this.logger.warn(`Error streaming partial download: ${String(err)}`);
        if (!res.headersSent) res.writeHead(500).end();
      });
    } else {
      res.writeHead(200, {
        "Content-Length": fileSizeBytes,
        "Accept-Ranges": "bytes",
        "Content-Type": responseContentType,
        "Content-Disposition": contentDisposition,
        "Cache-Control": "public, max-age=3600",
      });

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      const fileStream = fs.createReadStream(entry.filePath);
      fileStream.pipe(res);
      fileStream.on("error", (err) => {
        this.logger.warn(`Error streaming file download: ${String(err)}`);
        if (!res.headersSent) res.writeHead(500).end();
      });
    }
  }

  private async purgeExpiredFiles(): Promise<void> {
    const now = Date.now();
    let changed = false;

    for (const [token, entry] of this.entries.entries()) {
      if (now > entry.expiresAt) {
        this.logger.info(`Purging expired download: "${entry.filename}" (Token: ${token})`);
        this.entries.delete(token);
        changed = true;
        try {
          await fsPromises.unlink(entry.filePath);
        } catch {
          // File may already have been removed
        }
      }
    }

    if (changed) {
      await this.saveRegistry();
    }
  }

  private async saveRegistry(): Promise<void> {
    if (this.isSavingRegistry) {
      this.pendingSave = true;
      return;
    }
    this.isSavingRegistry = true;

    try {
      const data = Array.from(this.entries.values());
      const tempPath = `${this.registryPath}.${Date.now()}.${Math.random().toString(36).substring(2, 6)}.tmp`;
      await fsPromises.writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
      await fsPromises.rename(tempPath, this.registryPath);
    } catch (err: unknown) {
      this.logger.warn("Failed to persist download registry to disk", {
        error: String(err),
      });
    } finally {
      this.isSavingRegistry = false;
      if (this.pendingSave) {
        this.pendingSave = false;
        await this.saveRegistry();
      }
    }
  }

  private async loadRegistry(): Promise<void> {
    try {
      if (!fs.existsSync(this.registryPath)) {
        return;
      }
      const raw = await fsPromises.readFile(this.registryPath, "utf-8");
      const entries: DownloadEntry[] = JSON.parse(raw);
      if (!Array.isArray(entries)) {
        return;
      }

      const now = Date.now();
      let restoredCount = 0;
      let expiredCount = 0;

      for (const entry of entries) {
        if (!entry || !entry.token || !entry.filePath) continue;

        // Path Traversal Security check: file must reside strictly inside allowedDir
        const resolvedPath = path.resolve(entry.filePath);
        if (!resolvedPath.startsWith(this.allowedDir)) {
          this.logger.warn(`Ignoring entry outside allowed directory: ${resolvedPath}`);
          continue;
        }

        if (now < entry.expiresAt && fs.existsSync(resolvedPath)) {
          this.entries.set(entry.token, {
            ...entry,
            filePath: resolvedPath,
          });
          restoredCount++;
        } else {
          expiredCount++;
          if (fs.existsSync(resolvedPath)) {
            await fsPromises.unlink(resolvedPath).catch(() => {});
          }
        }
      }

      if (restoredCount > 0 || expiredCount > 0) {
        this.logger.info(
          `Reconciled download registry on startup: ${restoredCount} active link(s) restored, ${expiredCount} expired link(s) purged.`
        );
        await this.saveRegistry();
      }
    } catch (err: unknown) {
      this.logger.warn("Failed to parse existing download registry on startup, starting fresh", {
        error: String(err),
      });
    }
  }

  private async scavengeOrphanedDiskFiles(): Promise<void> {
    try {
      if (!fs.existsSync(this.allowedDir)) {
        return;
      }
      const files = await fsPromises.readdir(this.allowedDir);
      const now = Date.now();
      const maxAgeMs = this.defaultTtlMinutes * 60 * 1000;
      // 15-minute grace period for unindexed files to guarantee in-flight downloads are never interrupted
      const unindexedGracePeriodMs = 15 * 60 * 1000;
      let reclaimedBytes = 0;
      let prunedCount = 0;

      // Set of all currently registered active file paths in memory
      const registeredPaths = new Set(
        Array.from(this.entries.values()).map((e) => path.resolve(e.filePath))
      );

      for (const file of files) {
        // Never touch the registry or its temp files
        if (file.startsWith(".registry.json")) {
          continue;
        }

        const fullPath = path.resolve(path.join(this.allowedDir, file));
        let stats: fs.Stats;
        try {
          stats = await fsPromises.stat(fullPath);
        } catch {
          continue;
        }

        if (stats.isDirectory()) {
          continue;
        }

        const isTransient =
          file.endsWith(".part") ||
          file.endsWith(".ytdl") ||
          file.endsWith(".tmp") ||
          file.includes(".fixed.mp4");

        const isBotDownload = file.startsWith("dl_");

        // 1. Clean up transient artifacts older than grace period
        if (isTransient && now - stats.mtimeMs > unindexedGracePeriodMs) {
          reclaimedBytes += stats.size;
          prunedCount++;
          await fsPromises.unlink(fullPath).catch(() => {});
          continue;
        }

        // 2. Clean up media downloads:
        // - If registered: pruned when now > entry.expiresAt or stats.mtimeMs > maxAgeMs
        // - If unindexed: pruned once older than grace period (reclaims stale files from dead/restarted processes)
        if (isBotDownload) {
          const isRegistered = registeredPaths.has(fullPath);
          const isExpiredByMtime = now - stats.mtimeMs > maxAgeMs;
          const isUnindexedOrphan = !isRegistered && now - stats.mtimeMs > unindexedGracePeriodMs;

          if (isExpiredByMtime || isUnindexedOrphan) {
            reclaimedBytes += stats.size;
            prunedCount++;
            await fsPromises.unlink(fullPath).catch(() => {});
          }
        }
      }

      if (prunedCount > 0) {
        const sizeMb = (reclaimedBytes / (1024 * 1024)).toFixed(1);
        this.logger.info(
          `Disk scavenger reclaimed ${sizeMb} MB across ${prunedCount} stale/orphaned file(s).`
        );
      }
    } catch (err: unknown) {
      this.logger.warn("Failed to sweep orphaned files in downloads directory", {
        error: String(err),
      });
    }
  }

  private async resolvePublicIp(): Promise<string | null> {
    const providers = [
      "https://api.ipify.org",
      "http://checkip.amazonaws.com",
      "https://ifconfig.me/ip",
      "https://icanhazip.com",
    ];

    for (const provider of providers) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(provider, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const text = (await res.text()).trim();
          if (/^[\d.]+$/.test(text)) {
            return text;
          }
        }
      } catch {
        // try next provider
      }
    }

    this.logger.warn(
      "[nullptr] Could not auto-detect public IP. Please set FILE_SERVER_BASE_URL=http://<VPS_IP>:3000 in .env for direct download buttons."
    );
    return null;
  }
}
