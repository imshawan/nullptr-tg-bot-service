export interface MetaInfoProps {
  title: string;
  sizeMb: string;
  extension: string;
  expiresInHours: number;
}

export function MetaInfo({ title, sizeMb, extension, expiresInHours }: MetaInfoProps) {
  return (
    <>
      <h1 class="title">{title}</h1>
      <div class="meta-row">
        <div class="meta-item">📦 {sizeMb} MB</div>
        <div class="meta-item">📁 {extension.toUpperCase().replace(".", "")}</div>
        <div class="meta-item">⏱️ Expires in {expiresInHours}h</div>
      </div>
    </>
  );
}
