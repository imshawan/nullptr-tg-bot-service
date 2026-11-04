export type MediaFormat = "mp3" | "m4a" | "wav" | "mp4" | "webm" | "mkv";

export type MediaQuality = "best" | "1080p" | "720p" | "480p" | "360p" | "audio";

export type AudioBitrate = "128" | "192" | "256" | "320";

export interface MediaInfo {
  id: string;
  title: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  url: string;
  approxFilesize?: number;
}

export interface DownloadOptions {
  url: string;
  format: MediaFormat;
  quality?: MediaQuality;
  audioBitrate?: AudioBitrate;
  onProgress?: (progressPercent: number) => void;
}

export interface DownloadResult {
  filePath: string;
  filename: string;
  fileSizeBytes: number;
  title: string;
  duration?: number;
  format: MediaFormat;
  isAudio: boolean;
}
