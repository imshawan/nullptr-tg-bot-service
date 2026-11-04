import { MediaInfo, DownloadOptions, DownloadResult } from "./downloader.types";

export interface IDownloaderService {
  /** Check if a given string contains a downloadable video/audio URL */
  isSupportedUrl(text: string): boolean;

  /** Extract the first supported URL from a message string */
  extractUrl(text: string): string | null;

  /** Fetch metadata (title, uploader, thumbnail, duration) using yt-dlp */
  getMediaInfo(url: string): Promise<MediaInfo>;

  /** Download video or audio and return local file path and metadata */
  download(options: DownloadOptions): Promise<DownloadResult>;
}
