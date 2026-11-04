import { ILogger } from "@/core/logger/logger.interface";
import { LogLevel } from "@/core/types/common.types";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class ConsoleLogger implements ILogger {
  private readonly minLevelPriority: number;

  constructor(
    private readonly moduleName: string = "App",
    minLevel: LogLevel = "info"
  ) {
    this.minLevelPriority = LEVEL_PRIORITY[minLevel] ?? 20;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= this.minLevelPriority;
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private formatMessage(level: string, message: string): string {
    return `[${this.formatTimestamp()}] [${level.toUpperCase()}] [${this.moduleName}] ${message}`;
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog("debug")) return;
    const formatted = this.formatMessage("DEBUG", message);
    if (context) {
      console.debug(formatted, context);
    } else {
      console.debug(formatted);
    }
  }

  public info(message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog("info")) return;
    const formatted = this.formatMessage("INFO", message);
    if (context) {
      console.info(formatted, context);
    } else {
      console.info(formatted);
    }
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog("warn")) return;
    const formatted = this.formatMessage("WARN", message);
    if (context) {
      console.warn(formatted, context);
    } else {
      console.warn(formatted);
    }
  }

  public error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    if (!this.shouldLog("error")) return;
    const formatted = this.formatMessage("ERROR", message);
    console.error(formatted);
    if (error) {
      console.error(error);
    }
    if (context) {
      console.error("Context:", context);
    }
  }

  public child(prefix: string): ILogger {
    return new ConsoleLogger(`${this.moduleName}:${prefix}`);
  }
}
