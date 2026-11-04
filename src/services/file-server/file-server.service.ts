import http from "node:http";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { IFileServerService, DownloadEntry } from "./file-server.interface";
import { ILogger } from "@/core/logger/logger.interface";

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
  private readonly logger: ILogger;
  private server: http.Server | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly entries = new Map<string, DownloadEntry>();

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
    this.logger = options.logger.child("FileServer");
  }

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

    // Resolve base URL (configured or auto-detected public IP)
    if (this.configuredBaseUrl) {
      this.resolvedBaseUrl = this.configuredBaseUrl;
    } else {
      const publicIp = await this.resolvePublicIp();
      this.resolvedBaseUrl = publicIp ? `http://${publicIp}:${this.port}` : `http://localhost:${this.port}`;
    }

    this.server = http.createServer((req, res) => this.handleHttpRequest(req, res));

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, "0.0.0.0", () => {
        this.logger.info(`[nullptr] File Server active on port ${this.port}. Base URL: ${this.resolvedBaseUrl}`);
        resolve();
      });

      this.server!.on("error", (err) => {
        this.logger.error(`[nullptr] Failed to bind File Server on port ${this.port}:`, err);
        reject(err);
      });
    });

    // Start background file cleanup timer (runs every 10 minutes)
    this.cleanupTimer = setInterval(() => this.purgeExpiredFiles(), 10 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  public async stop(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          this.logger.info("[nullptr] File Server stopped.");
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

    const entry: DownloadEntry = {
      token,
      filePath,
      filename,
      title: title || filename,
      fileSizeBytes: stats.size,
      mimeType,
      createdAt: now,
      expiresAt: now + durationMs,
    };

    this.entries.set(token, entry);

    const safeFilename = encodeURIComponent(filename.replace(/[/\\?%*:|"<>]/g, "_"));
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
      res.end("404 Not Found - nullptr File Server");
      return;
    }

    const token = match[1];
    const entry = this.entries.get(token);

    if (!entry) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h3>404 Not Found</h3><p>This download link does not exist or has expired.</p>");
      return;
    }

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(token);
      await fsPromises.unlink(entry.filePath).catch(() => {});
      res.writeHead(410, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h3>410 Expired</h3><p>This download link has expired and the file has been purged.</p>");
      return;
    }

    // Security check: Path Traversal Jail. File must reside strictly inside the allowed downloads directory.
    const resolvedPath = path.resolve(entry.filePath);
    if (!resolvedPath.startsWith(this.allowedDir)) {
      this.logger.warn(`Security alert: Attempted access outside allowed directory: ${resolvedPath}`);
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("403 Forbidden - Access denied");
      return;
    }

    if (!fs.existsSync(entry.filePath)) {
      this.entries.delete(token);
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("File no longer exists on server.");
      return;
    }

    // Standard HTTP security headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'none'");

    const fileSizeBytes = entry.fileSizeBytes;
    const rangeHeader = req.headers.range;

    // Support HTTP Range requests (HTTP 206 Partial Content) for resumable downloads & media seeking
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSizeBytes - 1;

      if (isNaN(start) || start >= fileSizeBytes || end >= fileSizeBytes || start > end) {
        res.writeHead(416, {
          "Content-Range": `bytes */${fileSizeBytes}`,
        });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(entry.filePath, { start, end });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSizeBytes}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": entry.mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(entry.filename)}`,
      });

      fileStream.pipe(res);
      fileStream.on("error", (err) => {
        this.logger.warn(`Error streaming partial download: ${String(err)}`);
        if (!res.headersSent) res.writeHead(500).end();
      });
    } else {
      res.writeHead(200, {
        "Content-Length": fileSizeBytes,
        "Accept-Ranges": "bytes",
        "Content-Type": entry.mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(entry.filename)}`,
      });

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
    for (const [token, entry] of this.entries.entries()) {
      if (now > entry.expiresAt) {
        this.logger.info(`Purging expired download: "${entry.filename}" (Token: ${token})`);
        this.entries.delete(token);
        try {
          await fsPromises.unlink(entry.filePath);
        } catch {
          // File may already have been removed
        }
      }
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
