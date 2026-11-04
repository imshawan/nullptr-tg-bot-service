import { ICommandHandler, CommandContext } from "@/services/commands/command.interface";

export class StartCommand implements ICommandHandler {
  public readonly command = "start";
  public readonly description = "Start nullptr (NullPointer Bot) & show info";

  public async execute(ctx: CommandContext): Promise<void> {
    const host = ctx.llm.getHost();
    const activeModel = ctx.llm.getActiveModel();

    const message = [
      `🤖 *nullptr (NullPointer Bot)*`,
      `Connected to: \`${host}\``,
      `Active model: \`${activeModel}\``,
      "",
      "📋 *Available Commands:*",
      "/models - List all installed Ollama models",
      "/model <name> - Switch active model",
      "/clear - Clear conversation memory",
      "/status - Show nullptr connectivity & stats",
      "/help - Show this guide",
      "",
      "💡 _Tip: Type `/` anytime to view the nullptr command menu._",
    ].join("\n");

    await ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: message,
      parse_mode: "Markdown",
    });
  }
}
