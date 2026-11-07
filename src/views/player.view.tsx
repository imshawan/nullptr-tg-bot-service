import path from "node:path";
import { renderToString } from "preact-render-to-string";
import { MainLayout } from "@/views/layouts/main.layout";
import { BrandHeader } from "@/views/components/brand-header";
import { MediaBox } from "@/views/components/media-box";
import { MetaInfo } from "@/views/components/meta-info";
import { ActionButtons } from "@/views/components/action-buttons";
import { BrandFooter } from "@/views/components/brand-footer";

export interface PlayerViewProps {
  title: string;
  filename: string;
  fileSizeBytes: number;
  mimeType: string;
  streamUrl: string;
  directDownloadUrl: string;
  expiresAt: number;
}

export function PlayerView({
  title,
  filename,
  fileSizeBytes,
  mimeType,
  streamUrl,
  directDownloadUrl,
  expiresAt,
}: PlayerViewProps) {
  const isAudio = mimeType.startsWith("audio/");
  const sizeMb = (fileSizeBytes / (1024 * 1024)).toFixed(1);
  const ext = path.extname(filename).toLowerCase();
  const expiresInHours = Math.max(1, Math.round((expiresAt - Date.now()) / (60 * 60 * 1000)));

  return (
    <MainLayout title={`${title} - nullptr`}>
      <div class="media-card">
        <BrandHeader badgeText={isAudio ? "Audio Ready" : "Video Ready"} />
        <MediaBox isAudio={isAudio} streamUrl={streamUrl} mimeType={mimeType} />
        <div class="card-body">
          <MetaInfo
            title={title}
            sizeMb={sizeMb}
            extension={ext}
            expiresInHours={expiresInHours}
          />
          <ActionButtons
            directDownloadUrl={directDownloadUrl}
            filename={filename}
            sizeMb={sizeMb}
            streamUrl={streamUrl}
            isAudio={isAudio}
          />
        </div>
      </div>
      <BrandFooter />
    </MainLayout>
  );
}

export function renderPlayerView(props: PlayerViewProps): string {
  return "<!DOCTYPE html>\n" + renderToString(<PlayerView {...props} />);
}
