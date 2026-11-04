export type LogLevel = "debug" | "info" | "warn" | "error";

export interface IDisposable {
  dispose(): Promise<void> | void;
}
