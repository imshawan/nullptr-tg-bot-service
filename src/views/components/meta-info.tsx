export interface MetaInfoProps {
  title: string;
  sizeMb: string;
  extension: string;
  expiresInHours: number;
}

export function MetaInfo({ title, sizeMb, extension, expiresInHours }: MetaInfoProps) {
  const cleanExt = extension.replace(".", "").toUpperCase();

  return (
    <div class="title-row">
      <h1 class="item-title">{title}</h1>
      <div class="meta-badges">
        <span class="badge-chip highlight">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
            <polyline points="2 17 12 22 22 17"></polyline>
            <polyline points="2 12 12 17 22 12"></polyline>
          </svg>
          {cleanExt} Container
        </span>

        <span class="badge-chip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
          </svg>
          {sizeMb} MB
        </span>

        <span class="badge-chip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          Expires in {expiresInHours}h
        </span>
      </div>
    </div>
  );
}
