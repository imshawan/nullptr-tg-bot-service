import { ICommandHandler, CommandContext } from "@/services/commands/command.interface";

export class ModelCommand implements ICommandHandler {
  public readonly command = "model";
  public readonly description = "Switch active model for nullptr (/model <name>)";

  public async execute(ctx: CommandContext): Promise<void> {
    const target = ctx.args[0];

    if (!target) {
      const active = ctx.llm.getActiveModel();
      await ctx.telegram.sendMessage({
        chat_id: ctx.chatId,
        text: `nullptr (NullPointer Bot) current model: ${active}\n\nUsage: /model <model_name>\nRun /models to list available models.`,
      });
      return;
    }

    try {
      const models = await ctx.llm.listModels();
      const matched = models.find(
        (m) => m.name === target || m.name.startsWith(`${target}:`) || m.name.includes(target)
      );

      if (!matched) {
        const available = models.map((m) => m.name).join("\n");
        await ctx.telegram.sendMessage({
          chat_id: ctx.chatId,
          text: `[nullptr] Model "${target}" not found.\n\nAvailable:\n${available}`,
        });
        return;
      }

      ctx.llm.setActiveModel(matched.name);
      await ctx.sessionStore.clearHistory(ctx.chatId);

      await ctx.telegram.sendMessage({
        chat_id: ctx.chatId,
        text: `Switched nullptr model to: ${matched.name} (conversation context reset).`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.telegram.sendMessage({
        chat_id: ctx.chatId,
        text: `[nullptr] Failed to switch model: ${message}`,
      });
    }
  }
}
