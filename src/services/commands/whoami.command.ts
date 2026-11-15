import { BOT_NAME } from "@/config";
import { ICommandHandler, CommandContext } from "@/services/commands/command.interface";
import { formatWhoAmIResponse } from "@/utils/text.utils";

export class WhoAmICommand implements ICommandHandler {
  public readonly command = "whoami";
  public readonly description = `View your Telegram profile, ID & authorization role in ${BOT_NAME}`;
  public readonly aliases = ["id", "me"];

  public async execute(ctx: CommandContext): Promise<void> {
    const text = formatWhoAmIResponse(ctx.sender, BOT_NAME);

    try {
      await ctx.telegram.sendMessage({
        chat_id: ctx.chatId,
        text,
        parse_mode: "Markdown",
      });
    } catch {
      await ctx.telegram.sendMessage({
        chat_id: ctx.chatId,
        text,
      });
    }
  }
}
