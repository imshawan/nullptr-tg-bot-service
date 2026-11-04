import {
  getConfigLogLevel,
  getConfigTelegramToken,
  getConfigAllowedUserIds,
  getConfigStreamEditIntervalMs,
  getConfigOllamaHost,
  getConfigOllamaModel,
  getConfigOllamaAuth,
  getConfigSystemPrompt,
  getConfigMaxHistoryMessages,
  getConfigYtDlpPath,
  getConfigFfmpegPath,
  getConfigYtDlpProxy,
  getConfigDownloadTempDir,
  getConfigPort,
  getConfigFileServerBaseUrl,
  getConfigDownloadLinkTtlMinutes,
} from "@/config";
import { ConsoleLogger } from "@/core/logger/console-logger";
import { TelegramClient } from "@/domain/telegram/telegram.client";
import { OllamaProvider } from "@/domain/llm/ollama.provider";
import { InMemorySessionStore } from "@/domain/session/in-memory-session.store";
import { YtDlpDownloader } from "@/domain/downloader/ytdlp.downloader";
import { FileServerService } from "@/services/file-server/file-server.service";
import { CommandRegistry } from "@/services/command.registry";
import { BotService } from "@/services/bot.service";

// Import Commands
import { StartCommand } from "@/services/commands/start.command";
import { HelpCommand } from "@/services/commands/help.command";
import { DownloadCommand } from "@/services/commands/download.command";
import { ModelsCommand } from "@/services/commands/models.command";
import { ModelCommand } from "@/services/commands/model.command";
import { ClearCommand } from "@/services/commands/clear.command";
import { StatusCommand } from "@/services/commands/status.command";

async function bootstrap(): Promise<void> {
  // 1. Core logger initialization via config getter
  const logger = new ConsoleLogger("nullptr", getConfigLogLevel());
  logger.info("Starting nullptr (NullPointer Bot) Service...");

  const allowedUserIds = getConfigAllowedUserIds();
  const allowedCount = allowedUserIds.size;
  logger.info(
    `Security: ${allowedCount > 0 ? `${allowedCount} authorized user ID(s) configured for nullptr.` : "⚠️ Unrestricted access (no allowed IDs configured)!"}`
  );

  // 2. Domain layer initialization using typed getters
  const telegramClient = new TelegramClient(getConfigTelegramToken(), logger);

  const llmProvider = new OllamaProvider({
    host: getConfigOllamaHost(),
    defaultModel: getConfigOllamaModel(),
    authHeader: getConfigOllamaAuth(),
    systemPrompt: getConfigSystemPrompt(),
    logger,
  });

  const sessionStore = new InMemorySessionStore(getConfigMaxHistoryMessages());

  const downloader = new YtDlpDownloader({
    customYtDlpPath: getConfigYtDlpPath(),
    customFfmpegPath: getConfigFfmpegPath(),
    customProxy: getConfigYtDlpProxy(),
    tempDir: getConfigDownloadTempDir(),
    logger,
  });

  // 3. Direct HTTP File Server for large media downloads (> 50 MB)
  const fileServer = new FileServerService({
    port: getConfigPort(),
    baseUrl: getConfigFileServerBaseUrl(),
    defaultTtlMinutes: getConfigDownloadLinkTtlMinutes(),
    allowedDir: getConfigDownloadTempDir(),
    logger,
  });
  await fileServer.start();

  // 4. Command Registry setup (Command Pattern)
  const commandRegistry = new CommandRegistry(logger);
  commandRegistry.register(new StartCommand());
  commandRegistry.register(new HelpCommand());
  commandRegistry.register(new DownloadCommand());
  commandRegistry.register(new ModelsCommand());
  commandRegistry.register(new ModelCommand());
  commandRegistry.register(new ClearCommand());
  commandRegistry.register(new StatusCommand());

  // 5. Bot Service orchestrator
  const botService = new BotService(
    {
      allowedUserIds,
      streamEditIntervalMs: getConfigStreamEditIntervalMs(),
    },
    telegramClient,
    llmProvider,
    sessionStore,
    downloader,
    commandRegistry,
    fileServer,
    logger
  );

  // 6. Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Gracefully stopping nullptr (NullPointer Bot)...`);
    botService.stop();
    await fileServer.stop();
    // Allow pending requests to complete cleanly
    setTimeout(() => {
      logger.info("nullptr process exited.");
      process.exit(0);
    }, 1000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    logger.error("[nullptr] Unhandled Promise Rejection:", reason);
  });

  process.on("uncaughtException", (error) => {
    logger.error("[nullptr] Uncaught Exception thrown:", error);
    process.exit(1);
  });

  // 6. Start bot
  await botService.init();
  await botService.start();
}

bootstrap().catch((err: unknown) => {
  console.error("Fatal startup error in nullptr:", err);
  process.exit(1);
});
