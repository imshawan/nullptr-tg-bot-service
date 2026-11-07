export interface BrandHeaderProps {
  badgeText?: string;
  isError?: boolean;
}

export function BrandHeader({ badgeText = "Media Ready", isError = false }: BrandHeaderProps) {
  return (
    <div class="card-header">
      <div class="brand-badge">
        <div class="brand-icon">&gt;_</div>
        <span>nullptr</span>
      </div>
      <div class={`status-pill ${isError ? "error" : ""}`}>
        <span class="status-dot"></span>
        <span>{badgeText}</span>
      </div>
    </div>
  );
}
