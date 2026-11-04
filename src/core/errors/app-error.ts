export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = "INTERNAL_ERROR",
    public readonly details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, "CONFIGURATION_ERROR", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(public readonly userId?: number) {
    super(`User ID ${userId ?? "unknown"} is not authorized to interact with this service.`, "UNAUTHORIZED");
  }
}

export class TelegramApiError extends AppError {
  constructor(
    message: string,
    public readonly method: string,
    public readonly errorCode?: number,
    public readonly retryAfter?: number
  ) {
    super(message, "TELEGRAM_API_ERROR");
  }
}

export class LlmProviderError extends AppError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    details?: unknown
  ) {
    super(message, "LLM_PROVIDER_ERROR", details);
  }
}
