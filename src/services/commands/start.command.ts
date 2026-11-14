import { ICommandHandler, CommandContext } from "@/services/commands/command.interface";

export class StartCommand implements ICommandHandler {
  public readonly command = "start";
  public readonly description = "Start NullPointer & show info";

  public async execute(ctx: CommandContext): Promise<void> {
    const host = ctx.llm.getHost();
    const activeModel = ctx.llm.getActiveModel();

    const message = [
      `🤖 *NullPointer*`,
      `Connected to: \`${host}\``,
      `Active model: \`${activeModel}\``,
      `👨‍💻 *Creator:* Shawan Mandal ([@imshawan](https://imshawan.dev) · hello@imshawan.dev)`,
      "",
      "📋 *Available Commands:*",
      "/download <url> - Download video or MP3 audio from any link",
      "/models - List all installed Ollama models",
      "/model <name> - Switch active model",
      "/clear - Clear conversation memory",
      "/status - ShowNullPointerconnectivity & stats",
      "/help - Show this guide",
      "",
      "💡 _Tip: Type `/` anytime to view theNullPointercommand menu._",
    ].join("\n");

    await ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: message,
      parse_mode: "Markdown",
    });
  }
}
