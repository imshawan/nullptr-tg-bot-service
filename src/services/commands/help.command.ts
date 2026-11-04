import { ICommandHandler, CommandContext } from "@/services/commands/command.interface";

export class HelpCommand implements ICommandHandler {
  public readonly command = "help";
  public readonly description = "Show nullptr (NullPointer Bot) commands & guide";

  public async execute(ctx: CommandContext): Promise<void> {
    const host = ctx.llm.getHost();
    const activeModel = ctx.llm.getActiveModel();

    const message = [
      `📖 *nullptr (NullPointer Bot) Guide*`,
      `Connected to: \`${host}\``,
      `Active model: \`${activeModel}\``,
      "",
      "📋 *Command Reference:*",
      "• `/start` — Welcome screen & quick bot overview",
      "• `/help` — Detailed command reference (this message)",
      "• `/models` — List all installed models on Oracle Cloud",
      "• `/model <name>` — Switch active LLM model",
      "• `/clear` — Reset conversation context & memory",
      "• `/status` — Measure round-trip latency & server health",
      "",
      "💡 *Tips:*",
      "— Type `/` at any time to open the quick autocomplete menu.",
      "— nullptr automatically remembers context up to the configured message limit.",
      "— Switching models with `/model` clears previous conversation memory.",
    ].join("\n");

    await ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: message,
      parse_mode: "Markdown",
    });
  }
}
