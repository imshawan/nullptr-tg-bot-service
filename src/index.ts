import dns from "node:dns";

// Prioritize IPv4 over IPv6 across all Node.js networking to prevent IPv6 blackholing on Oracle Cloud VCNs
dns.setDefaultResultOrder("ipv4first");

import {
  BOT_NAME,
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
  const logger = new ConsoleLogger(BOT_NAME, getConfigLogLevel());
  logger.info(`Starting ${BOT_NAME} Service...`);

  const allowedUserIds = getConfigAllowedUserIds();
  const allowedCount = allowedUserIds.size;
  logger.info(
    `Security: ${allowedCount > 0 ? `${allowedCount} authorized user(s) configured for ${BOT_NAME}.` : "⚠️ Unrestricted access (no allowed IDs configured)!"}`
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
    logger.info(`Received ${signal}. Gracefully stopping ${BOT_NAME}...`);
    botService.stop();
    await fileServer.stop();
    // Allow pending requests to complete cleanly
    setTimeout(() => {
      logger.info(`${BOT_NAME} process exited.`);
      process.exit(0);
    }, 1000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    logger.error(`[${BOT_NAME}] Unhandled Promise Rejection:`, reason);
  });

  process.on("uncaughtException", (error) => {
    logger.error(`[${BOT_NAME}] Uncaught Exception thrown:`, error);
    process.exit(1);
  });

  // 6. Start bot
  await botService.init();
  await botService.start();
}

bootstrap().catch((err: unknown) => {
  console.error(`Fatal startup error in ${BOT_NAME}:`, err);
  process.exit(1);
});
