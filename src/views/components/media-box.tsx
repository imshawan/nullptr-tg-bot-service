export interface MediaBoxProps {
  isAudio: boolean;
  streamUrl: string;
  mimeType: string;
}

export function MediaBox({ isAudio, streamUrl, mimeType }: MediaBoxProps) {
  return (
    <div class="media-box">
      {isAudio ? (
        <audio controls autoPlay preload="metadata">
          <source src={streamUrl} type={mimeType} />
          Your browser does not support audio playback.
        </audio>
      ) : (
        <video controls autoPlay playsInline preload="metadata">
          <source src={streamUrl} type={mimeType} />
          Your browser does not support video playback.
        </video>
      )}
    </div>
  );
}
