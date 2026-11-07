export interface ActionButtonsProps {
  directDownloadUrl: string;
  filename: string;
  sizeMb: string;
  streamUrl: string;
}

export function ActionButtons({ directDownloadUrl, filename, sizeMb, streamUrl }: ActionButtonsProps) {
  return (
    <div class="actions">
      <a href={directDownloadUrl} class="btn btn-download" download={filename}>
        📥 Download File ({sizeMb} MB)
      </a>
      <a href={streamUrl} class="btn btn-stream" target="_blank" rel="noreferrer">
        ▶️ Direct Stream Link
      </a>
    </div>
  );
}
