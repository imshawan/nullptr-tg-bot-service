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

export function ErrorView({ statusCode, title, message, icon = "⚠️" }: ErrorViewProps) {
  return (
    <MainLayout title={`${statusCode} ${title} - nullptr`}>
      <div class="card">
        <BrandHeader badgeText={`${statusCode} Error`} isError={true} />
        <div class="error-box">
          <div class="error-icon">{icon}</div>
          <h1 class="error-title">{title}</h1>
          <p class="error-desc">{message}</p>
        </div>
      </div>
      <BrandFooter />
    </MainLayout>
  );
}

export function renderErrorView(props: ErrorViewProps): string {
  return "<!DOCTYPE html>\n" + renderToString(<ErrorView {...props} />);
}
