export type MediaFormat =
  | "mp3"
  | "m4a"
  | "wav"
  | "flac"
  | "aac"
  | "opus"
  | "mp4"
  | "webm"
  | "mkv";

export type MediaQuality =
  | "best"
  | "8k"
  | "4k"
  | "2160p"
  | "1440p"
  | "1080p"
  | "720p"
  | "480p"
  | "360p"
  | "240p"
  | "144p"
  | "audio"
  | "unknown";

export type AudioBitrate = "128" | "192" | "256" | "320";

export interface VideoResolutionOption {
  quality: MediaQuality;
  height?: number;
  label: string;
  approxSizeBytes?: number;
}

export interface MediaInfo {
  id: string;
  title: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  url: string;
  approxFilesize?: number;
  availableVideoQualities?: VideoResolutionOption[];
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
