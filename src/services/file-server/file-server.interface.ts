export interface DownloadEntry {
  token: string;
  filePath: string;
  filename: string;
  title: string;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: number;
  expiresAt: number;
}

export interface IFileServerService {
  /** Starts the local HTTP file server */
  start(): Promise<void>;

  /** Stops the HTTP file server and cleans up active timers */
  stop(): Promise<void>;

  /**
   * Registers a downloaded file for direct HTTP streaming.
   * Returns the absolute public download URL.
   */
  registerDownload(filePath: string, filename: string, title?: string, ttlMinutes?: number): Promise<string>;

  /** Returns the current base URL (e.g. http://140.238.x.x:3000) */
  getBaseUrl(): string;

  /** Checks if the HTTP server is currently listening */
  isReady(): boolean;
}
