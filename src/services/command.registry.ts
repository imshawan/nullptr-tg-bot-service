import { ICommandHandler, CommandContext } from "@/services/commands/command.interface";
import { BotCommand } from "@/domain/telegram/telegram.types";
import { ILogger } from "@/core/logger/logger.interface";

export class CommandRegistry {
  private readonly handlers = new Map<string, ICommandHandler>();
  private readonly logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger.child("CommandRegistry");
  }

  public register(handler: ICommandHandler): void {
    const mainCmd = handler.command.toLowerCase();
    this.handlers.set(mainCmd, handler);

    if (handler.aliases) {
      for (const alias of handler.aliases) {
        this.handlers.set(alias.toLowerCase(), handler);
      }
    }

    this.logger.debug(`Registered command handler: /${mainCmd}`);
  }

  public getBotCommands(): BotCommand[] {
    const seen = new Set<string>();
    const commands: BotCommand[] = [];

    for (const handler of this.handlers.values()) {
      if (seen.has(handler.command)) continue;
      seen.add(handler.command);
      commands.push({
        command: handler.command,
        description: handler.description,
      });
    }

    return commands;
  }

  public async dispatch(commandText: string, context: Omit<CommandContext, "rawText" | "args">): Promise<boolean> {
    const trimmed = commandText.trim();
    if (!trimmed.startsWith("/")) return false;

    const [rawCmd, ...args] = trimmed.split(/\s+/);
    // Strip leading slash and potential @botusername suffix
    const cmdName = rawCmd.slice(1).split("@")[0].toLowerCase();

    const handler = this.handlers.get(cmdName);
    if (!handler) {
      return false;
    }

    try {
      await handler.execute({
        ...context,
        rawText: trimmed,
        args,
      });
      return true;
    } catch (err: unknown) {
      this.logger.error(`Error executing command /${cmdName}:`, err);
      await context.telegram.sendMessage({
        chat_id: context.chatId,
        text: `⚠️ An error occurred while executing /${cmdName}. Check server logs.`,
      });
      return true;
    }
  }
}
