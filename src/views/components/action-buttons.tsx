export interface ActionButtonsProps {
  directDownloadUrl: string;
  filename: string;
  sizeMb: string;
  streamUrl: string;
  isAudio?: boolean;
}

export function ActionButtons({
  directDownloadUrl,
  filename,
  sizeMb,
  streamUrl,
  isAudio = false,
}: ActionButtonsProps) {
  const downloadLabel = isAudio
    ? `Download Audio (${sizeMb} MB)`
    : `Download Video (${sizeMb} MB)`;

  return (
    <div class="actions-container">
      <a href={directDownloadUrl} class="primary-action-btn" download={filename}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        {downloadLabel}
      </a>

      <div class="secondary-action-grid">
        <a href={streamUrl} class="secondary-action-btn" target="_blank" rel="noreferrer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          Open Direct Stream
        </a>

        <button type="button" class="secondary-action-btn" id="copyLinkBtn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy Link
        </button>
      </div>

      <script dangerouslySetInnerHTML={{
        __html: `
        (function() {
          const btn = document.getElementById('copyLinkBtn');
          const toast = document.getElementById('toast');
          if (!btn) return;

          btn.addEventListener('click', function() {
            const url = window.location.href;
            if (navigator.clipboard) {
              navigator.clipboard.writeText(url).then(showToast);
            } else {
              const el = document.createElement('textarea');
              el.value = url;
              document.body.appendChild(el);
              el.select();
              document.execCommand('copy');
              document.body.removeChild(el);
              showToast();
            }
          });

          function showToast() {
            if (!toast) return;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2000);
          }
        })();
        `
      }} />
    </div>
  );
}
