import { ComponentChildren } from "preact";

export interface MainLayoutProps {
  title: string;
  children: ComponentChildren;
}

export function MainLayout({ title, children }: MainLayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
        <title>{title}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <style>{`
          :root {
            --bg: #07090e;
            --card-bg: #0f131c;
            --card-border: rgba(255, 255, 255, 0.08);
            --card-border-hover: rgba(255, 255, 255, 0.14);
            --text-main: #ffffff;
            --text-sub: #94a3b8;
            --text-muted: #64748b;
            --accent: #38bdf8;
            --btn-primary-bg: #ffffff;
            --btn-primary-text: #07090e;
            --btn-secondary-bg: rgba(255, 255, 255, 0.06);
            --btn-secondary-border: rgba(255, 255, 255, 0.12);
            --btn-secondary-hover: rgba(255, 255, 255, 0.12);
            --chip-bg: rgba(255, 255, 255, 0.04);
            --chip-border: rgba(255, 255, 255, 0.08);
            --radius-card: 20px;
            --radius-btn: 12px;
            --radius-chip: 8px;
            --card-height: 490px;
            --viewport-height: 180px;
          }

          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            -webkit-tap-highlight-color: transparent;
          }

          body {
            background-color: var(--bg);
            background-image: 
              radial-gradient(ellipse 60% 40% at 50% 0%, rgba(56, 189, 248, 0.08), transparent 70%),
              radial-gradient(ellipse 40% 30% at 50% 100%, rgba(99, 102, 241, 0.05), transparent 70%);
            background-attachment: fixed;
            color: var(--text-main);
            font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 24px 16px;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }

          .container {
            width: 100%;
            max-width: 440px;
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          /* EXACT UNIFORM CONTAINER: 490px across all screens */
          .media-card {
            width: 100%;
            height: var(--card-height);
            min-height: var(--card-height);
            max-height: var(--card-height);
            display: flex;
            flex-direction: column;
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: var(--radius-card);
            box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.7);
            transition: border-color 0.2s ease;
            position: relative;
            overflow: hidden;
          }
          .media-card:hover {
            border-color: var(--card-border-hover);
          }

          /* Header Bar: Exact 46px fixed */
          .card-header {
            height: 46px;
            min-height: 46px;
            max-height: 46px;
            flex-shrink: 0;
            padding: 0 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--card-border);
            background: rgba(255, 255, 255, 0.015);
          }
          .brand-badge {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.86rem;
            font-weight: 600;
            letter-spacing: -0.01em;
            color: #ffffff;
          }
          .brand-icon {
            width: 20px;
            height: 20px;
            border-radius: 5px;
            background: rgba(56, 189, 248, 0.15);
            border: 1px solid rgba(56, 189, 248, 0.3);
            color: var(--accent);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: 700;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
          }
          .status-pill {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-size: 0.7rem;
            font-weight: 500;
            color: var(--accent);
            padding: 3px 8px;
            border-radius: 9999px;
            background: rgba(56, 189, 248, 0.08);
            border: 1px solid rgba(56, 189, 248, 0.2);
          }
          .status-pill.error {
            color: #f87171;
            background: rgba(239, 68, 68, 0.08);
            border-color: rgba(239, 68, 68, 0.25);
          }
          .status-dot {
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background: currentColor;
          }

          /* UNIFIED VIEWPORT: 180px fixed on both Video & Audio */
          .viewport-box {
            height: var(--viewport-height);
            min-height: var(--viewport-height);
            max-height: var(--viewport-height);
            flex-shrink: 0;
            background: #000000;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            border-bottom: 1px solid var(--card-border);
            overflow: hidden;
          }

          /* Video Viewport */
          .video-viewport video {
            width: 100%;
            height: 100%;
            object-fit: contain;
            outline: none;
            display: block;
          }

          /* Audio Viewport */
          .audio-viewport-content {
            width: 100%;
            height: 100%;
            background: radial-gradient(circle at 50% 25%, rgba(56, 189, 248, 0.09) 0%, #000000 80%);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 14px 20px;
            gap: 14px;
          }

          .audio-artwork-badge {
            width: 44px;
            height: 44px;
            border-radius: 12px;
            background: linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(30, 41, 59, 0.8));
            border: 1px solid rgba(56, 189, 248, 0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--accent);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5), 0 0 16px rgba(56, 189, 248, 0.2);
          }

          .audio-player-core {
            width: 100%;
            max-width: 360px;
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .play-pause-btn {
            width: 38px;
            height: 38px;
            border-radius: 50%;
            background: #ffffff;
            color: #000000;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            transition: transform 0.15s ease, background-color 0.15s ease;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
          }
          .play-pause-btn:hover {
            transform: scale(1.05);
            background: #f1f5f9;
          }
          .play-pause-btn:active {
            transform: scale(0.96);
          }
          .audio-track-details {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .scrub-wrapper {
            display: flex;
            flex-direction: column;
            gap: 3px;
          }
          .audio-slider {
            width: 100%;
            -webkit-appearance: none;
            appearance: none;
            height: 4px;
            border-radius: 2px;
            background: rgba(255, 255, 255, 0.2);
            outline: none;
            cursor: pointer;
          }
          .audio-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #ffffff;
            box-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
            cursor: pointer;
          }
          .time-row {
            display: flex;
            justify-content: space-between;
            font-size: 0.7rem;
            color: var(--text-muted);
            font-variant-numeric: tabular-nums;
          }

          /* CARD BODY: Exactly 264px remaining, space-between layout */
          .card-body {
            flex: 1;
            padding: 18px 20px 20px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            min-height: 0;
          }

          .title-row {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .item-title {
            font-size: 1.02rem;
            font-weight: 600;
            color: var(--text-main);
            line-height: 1.35;
            letter-spacing: -0.015em;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }
          .meta-badges {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
          }
          .badge-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 8px;
            border-radius: var(--radius-chip);
            background: var(--chip-bg);
            border: 1px solid var(--chip-border);
            font-size: 0.7rem;
            font-weight: 500;
            color: var(--text-sub);
          }
          .badge-chip.highlight {
            color: var(--accent);
            border-color: rgba(56, 189, 248, 0.25);
            background: rgba(56, 189, 248, 0.06);
          }
          .badge-chip svg {
            width: 12px;
            height: 12px;
            opacity: 0.85;
          }

          /* ACTION BUTTONS (GUARANTEED 100% VISIBLE AT BOTTOM) */
          .actions-container {
            display: flex;
            flex-direction: column;
            gap: 8px;
            flex-shrink: 0;
          }

          .primary-action-btn {
            width: 100%;
            height: 42px;
            min-height: 42px;
            flex-shrink: 0;
            border-radius: var(--radius-btn);
            background: var(--btn-primary-bg);
            color: var(--btn-primary-text);
            font-size: 0.86rem;
            font-weight: 600;
            letter-spacing: -0.01em;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            border: none;
            cursor: pointer;
            transition: background-color 0.15s ease, transform 0.15s ease;
            box-shadow: 0 3px 10px rgba(255, 255, 255, 0.1);
          }
          .primary-action-btn:hover {
            background: #f1f5f9;
            transform: translateY(-1px);
          }
          .primary-action-btn:active {
            transform: translateY(0);
          }

          .secondary-action-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            flex-shrink: 0;
          }
          .secondary-action-btn {
            width: 100%;
            height: 38px;
            min-height: 38px;
            flex-shrink: 0;
            border-radius: var(--radius-btn);
            background: var(--btn-secondary-bg);
            color: #e2e8f0;
            border: 1px solid var(--btn-secondary-border);
            font-size: 0.8rem;
            font-weight: 500;
            letter-spacing: -0.01em;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            cursor: pointer;
            transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
            font-family: inherit;
            white-space: nowrap;
          }
          .secondary-action-btn:hover {
            background: var(--btn-secondary-hover);
            border-color: rgba(255, 255, 255, 0.2);
            transform: translateY(-1px);
          }
          .secondary-action-btn:active {
            transform: translateY(0);
          }

          /* ERROR SCREEN CONTENT */
          .error-card-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 24px;
            text-align: center;
            gap: 12px;
          }
          .error-glyph {
            width: 52px;
            height: 52px;
            border-radius: 14px;
            background: rgba(239, 68, 68, 0.08);
            border: 1px solid rgba(239, 68, 68, 0.2);
            color: #f87171;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 16px rgba(239, 68, 68, 0.15);
          }
          .error-number {
            font-size: 2.6rem;
            font-weight: 800;
            letter-spacing: -0.03em;
            color: #ffffff;
            line-height: 1;
          }
          .error-heading {
            font-size: 1.05rem;
            font-weight: 600;
            color: var(--text-main);
            letter-spacing: -0.01em;
          }
          .error-description {
            font-size: 0.82rem;
            color: var(--text-sub);
            max-width: 320px;
            line-height: 1.5;
          }

          /* Footer */
          .footer-bar {
            margin-top: 12px;
            text-align: center;
            font-size: 0.72rem;
            color: var(--text-muted);
          }
          .footer-bar a {
            color: var(--text-sub);
            text-decoration: none;
            transition: color 0.15s ease;
          }
          .footer-bar a:hover {
            color: var(--accent);
          }

          /* Toast Notification */
          #toast {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(30px);
            background: #1e293b;
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.15);
            padding: 8px 16px;
            border-radius: 9999px;
            font-size: 0.78rem;
            font-weight: 500;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
            opacity: 0;
            pointer-events: none;
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            z-index: 1000;
          }
          #toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }

          @media (max-width: 480px) {
            body { padding: 14px 10px; }
          }
        `}</style>
      </head>
      <body>
        <div class="container">{children}</div>
        <div id="toast">Copied to clipboard!</div>
      </body>
    </html>
  );
}
