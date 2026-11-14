import { ICommandHandler, CommandContext } from "@/services/commands/command.interface";

export class HelpCommand implements ICommandHandler {
  public readonly command = "help";
  public readonly description = "Show NullPointer commands & guide";

  public async execute(ctx: CommandContext): Promise<void> {
    const host = ctx.llm.getHost();
    const activeModel = ctx.llm.getActiveModel();

    const message = [
      `📖 *NullPointer Guide*`,
      `Connected to: \`${host}\``,
      `Active model: \`${activeModel}\``,
      `👨‍💻 *Created & Managed by:* Shawan Mandal ([@imshawan](https://imshawan.dev) · hello@imshawan.dev)`,
      "",
      "📋 *Command Reference:*",
      "• `/download <url> [format]` — Download video (MP4/720p/480p) or audio (MP3/M4A)",
      "• `/start` — Welcome screen & quick bot overview",
      "• `/help` — Detailed command reference (this message)",
      "• `/models` — List all installed models on Oracle Cloud",
      "• `/model <name>` — Switch active LLM model",
      "• `/clear` — Reset conversation context & memory",
      "• `/status` — Measure round-trip latency & server health",
      "",
      "💡 *Tips:*",
      "— Paste any YouTube, Twitter, Instagram, or TikTok link to download interactively.",
      "— Type `/` at any time to open the quick autocomplete menu.",
      "—NullPointerautomatically remembers context up to the configured message limit.",
      "— Switching models with `/model` clears previous conversation memory.",
    ].join("\n");

    await ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: message,
      parse_mode: "Markdown",
    });
  }
}
