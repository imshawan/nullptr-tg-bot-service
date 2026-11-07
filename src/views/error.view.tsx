import { renderToString } from "preact-render-to-string";
import { MainLayout } from "@/views/layouts/main.layout";
import { BrandHeader } from "@/views/components/brand-header";
import { BrandFooter } from "@/views/components/brand-footer";

export interface ErrorViewProps {
  statusCode: number;
  title: string;
  message: string;
  icon?: string;
}

export function ErrorView({ statusCode, title, message }: ErrorViewProps) {
  return (
    <MainLayout title={`${statusCode} ${title} - nullptr`}>
      <div class="media-card">
        <BrandHeader badgeText={`${statusCode} Error`} isError={true} />
        <div class="error-card-content">
          <div class="error-glyph">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <div class="error-number">{statusCode}</div>
          <h1 class="error-heading">{title}</h1>
          <p class="error-description">{message}</p>
        </div>
      </div>
      <BrandFooter />
    </MainLayout>
  );
}

export function renderErrorView(props: ErrorViewProps): string {
  return "<!DOCTYPE html>\n" + renderToString(<ErrorView {...props} />);
}
