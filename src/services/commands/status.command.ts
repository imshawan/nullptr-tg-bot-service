import { ICommandHandler, CommandContext } from "@/services/commands/command.interface";

export class StatusCommand implements ICommandHandler {
  public readonly command = "status";
  public readonly description = "Check nullptr & Oracle Cloud connectivity";

  public async execute(ctx: CommandContext): Promise<void> {
    const health = await ctx.llm.checkHealth();
    const historyCount = await ctx.sessionStore.getMessageCount(ctx.chatId);
    const host = ctx.llm.getHost();
    const activeModel = ctx.llm.getActiveModel();

    let text: string;
    if (health.ok) {
      text = [
        `🟢 *nullptr (NullPointer Bot) - Status: Online*`,
        `Latency: ${health.latencyMs}ms`,
        `Host: \`${host}\``,
        `Active model: \`${activeModel}\``,
        `Available models: ${health.availableModelsCount}`,
        `Current conversation depth: ${historyCount} messages`,
      ].join("\n");
    } else {
      text = [
        `🔴 *nullptr (NullPointer Bot) - Status: Offline / Unreachable*`,
        `Host: \`${host}\``,
        `Error: ${health.error}`,
        "",
        `_Tip: Verify Oracle Cloud VCN Security List (ingress 11434) and Ubuntu iptables._`,
      ].join("\n");
    }

    await ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text,
      parse_mode: "Markdown",
    });
  }
}
