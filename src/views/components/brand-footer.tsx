import { BOT_NAME } from "@/config";

export function BrandFooter() {
  return (
    <div class="footer-bar">
      Powered by <strong>{BOT_NAME}</strong> · Created &amp; Managed by{" "}
      <a href="https://imshawan.dev" target="_blank" rel="noopener noreferrer">
        Shawan Mandal
      </a>
    </div>
  );
}
