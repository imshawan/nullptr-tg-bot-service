export interface BrandHeaderProps {
  badgeText?: string;
  isError?: boolean;
}

export function BrandHeader({ badgeText = "Live Stream & Download", isError = false }: BrandHeaderProps) {
  return (
    <div class="card-header">
      <div class="brand">
        <span>🤖 nullptr</span>
      </div>
      <span class={`badge ${isError ? "badge-danger" : ""}`}>{badgeText}</span>
    </div>
  );
}
