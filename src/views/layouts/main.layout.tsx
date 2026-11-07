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
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <style>{`
          :root {
            --bg: #0b0f19;
            --card-bg: #111827;
            --border: #1f2937;
            --text-primary: #f9fafb;
            --text-secondary: #9ca3af;
            --accent: #38bdf8;
            --btn-primary: #2563eb;
            --btn-primary-hover: #1d4ed8;
            --btn-secondary: #374151;
            --btn-secondary-hover: #4b5563;
            --danger: #ef4444;
            --danger-bg: rgba(239, 68, 68, 0.12);
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background-color: var(--bg);
            color: var(--text-primary);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 16px;
          }
          .card {
            width: 100%;
            max-width: 820px;
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          }
          .card-header {
            padding: 14px 20px;
            border-bottom: 1px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(17, 24, 39, 0.8);
          }
          .brand {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 700;
            font-size: 1.05rem;
            color: var(--accent);
            letter-spacing: -0.01em;
          }
          .badge {
            font-size: 0.75rem;
            font-weight: 600;
            padding: 4px 10px;
            border-radius: 9999px;
            background: rgba(56, 189, 248, 0.12);
            color: var(--accent);
            border: 1px solid rgba(56, 189, 248, 0.25);
          }
          .badge-danger {
            background: var(--danger-bg);
            color: var(--danger);
            border: 1px solid rgba(239, 68, 68, 0.25);
          }
          .media-box {
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 220px;
          }
          video {
            width: 100%;
            max-height: 68vh;
            display: block;
            outline: none;
          }
          audio {
            width: 90%;
            margin: 36px auto;
            outline: none;
          }
          .card-body {
            padding: 24px;
          }
          .title {
            font-size: 1.25rem;
            font-weight: 600;
            line-height: 1.4;
            margin-bottom: 12px;
            word-break: break-word;
          }
          .meta-row {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            font-size: 0.875rem;
            color: var(--text-secondary);
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border);
          }
          .meta-item {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
          }
          .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 12px 24px;
            border-radius: 10px;
            font-weight: 600;
            font-size: 0.95rem;
            text-decoration: none;
            transition: all 0.15s ease-in-out;
            cursor: pointer;
          }
          .btn-download {
            background: var(--btn-primary);
            color: #fff;
            flex: 1;
            min-width: 220px;
          }
          .btn-download:hover {
            background: var(--btn-primary-hover);
            transform: translateY(-1px);
          }
          .btn-stream {
            background: var(--btn-secondary);
            color: #f3f4f6;
          }
          .btn-stream:hover {
            background: var(--btn-secondary-hover);
          }
          .error-box {
            text-align: center;
            padding: 48px 24px;
          }
          .error-icon {
            font-size: 3rem;
            margin-bottom: 16px;
          }
          .error-title {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 8px;
          }
          .error-desc {
            color: var(--text-secondary);
            font-size: 0.95rem;
            max-width: 480px;
            margin: 0 auto;
            line-height: 1.5;
          }
          .footer {
            margin-top: 18px;
            font-size: 0.8rem;
            color: var(--text-secondary);
            text-align: center;
          }
          .footer a {
            color: var(--accent);
            text-decoration: none;
          }
        `}</style>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
