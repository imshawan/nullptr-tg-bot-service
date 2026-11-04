import http from "node:http";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { IFileServerService, DownloadEntry } from "./file-server.interface";
import { ILogger } from "@/core/logger/logger.interface";
import { escapeHtml } from "@/utils/text.utils";

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
      const isAudio = entry.mimeType.startsWith("audio/");
      const sizeMb = (entry.fileSizeBytes / (1024 * 1024)).toFixed(1);
      const ext = path.extname(entry.filename).toLowerCase();
      const expiresInHours = Math.max(1, Math.round((entry.expiresAt - Date.now()) / (60 * 60 * 1000)));
      const streamUrl = `${pathname}?stream=1`;
      const directDownloadUrl = `${pathname}?dl=1`;

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(entry.title)} - nullptr</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --border: #1f2937;
      --text-primary: #f9fafb;
      --text-secondary: #9ca3af;
      --accent: #38bdf8;
      --btn-primary: #2563eb;
      --btn-primary-hover: #1d4ed8;
      --btn-secondary: #374151;
      --btn-secondary-hover: #4b5563;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .card {
      width: 100%;
      max-width: 820px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
    .card-header {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(17, 24, 39, 0.8);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 1.05rem;
      color: var(--accent);
      letter-spacing: -0.01em;
    }
    .badge {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.12);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.25);
    }
    .media-box {
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 220px;
    }
    video {
      width: 100%;
      max-height: 68vh;
      display: block;
      outline: none;
    }
    audio {
      width: 90%;
      margin: 36px auto;
      outline: none;
    }
    .card-body {
      padding: 24px;
    }
    .title {
      font-size: 1.25rem;
      font-weight: 600;
      line-height: 1.4;
      margin-bottom: 12px;
      word-break: break-word;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 24px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.95rem;
      text-decoration: none;
      transition: all 0.15s ease-in-out;
      cursor: pointer;
    }
    .btn-download {
      background: var(--btn-primary);
      color: #fff;
      flex: 1;
      min-width: 220px;
    }
    .btn-download:hover {
      background: var(--btn-primary-hover);
      transform: translateY(-1px);
    }
    .btn-stream {
      background: var(--btn-secondary);
      color: #f3f4f6;
    }
    .btn-stream:hover {
      background: var(--btn-secondary-hover);
    }
    .footer {
      margin-top: 18px;
      font-size: 0.8rem;
      color: var(--text-secondary);
      text-align: center;
    }
    .footer a {
      color: var(--accent);
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <div class="brand">
        <span>🤖 nullptr</span>
      </div>
      <span class="badge">Live Stream &amp; Download</span>
    </div>

    <div class="media-box">
      ${isAudio ? `
        <audio controls autoplay preload="metadata">
          <source src="${streamUrl}" type="${entry.mimeType}">
          Your browser does not support audio playback.
        </audio>
      ` : `
        <video controls autoplay playsinline preload="metadata">
          <source src="${streamUrl}" type="${entry.mimeType}">
          Your browser does not support video playback.
        </video>
      `}
    </div>

    <div class="card-body">
      <h1 class="title">${escapeHtml(entry.title)}</h1>
      <div class="meta-row">
        <div class="meta-item">📦 ${sizeMb} MB</div>
        <div class="meta-item">📁 ${escapeHtml(ext.toUpperCase().replace('.', ''))}</div>
        <div class="meta-item">⏱️ Expires in ${expiresInHours}h</div>
      </div>

      <div class="actions">
        <a href="${directDownloadUrl}" class="btn btn-download" download="${escapeHtml(entry.filename)}">
          📥 Download File (${sizeMb} MB)
        </a>
        <a href="${streamUrl}" class="btn btn-stream" target="_blank">
          ▶️ Direct Stream Link
        </a>
      </div>
    </div>
  </div>

  <div class="footer">
    Powered by <strong>nullptr (NullPointer Bot)</strong> · Created &amp; Managed by <a href="https://imshawan.dev" target="_blank" rel="noopener">Shawan Mandal</a>
  </div>
</body>
</html>`;

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
