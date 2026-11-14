import { BOT_NAME } from "@/config";
import { ICommandHandler, CommandContext } from "@/services/commands/command.interface";

export class ClearCommand implements ICommandHandler {
  public readonly command = "clear";
  public readonly description = `Clear ${BOT_NAME} conversation context & memory`;

  public async execute(ctx: CommandContext): Promise<void> {
    await ctx.sessionStore.clearHistory(ctx.chatId);
    await ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: `🧹 ${BOT_NAME} conversation context cleared.`,
    });
  }
}
