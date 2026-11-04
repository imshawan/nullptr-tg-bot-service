import { ICommandHandler, CommandContext } from "@/services/commands/command.interface";
import { splitMessageText } from "@/utils/text.utils";

export class ModelsCommand implements ICommandHandler {
  public readonly command = "models";
  public readonly description = "List installed Ollama models for nullptr";

  public async execute(ctx: CommandContext): Promise<void> {
    try {
      const models = await ctx.llm.listModels();
      const active = ctx.llm.getActiveModel();

      if (!models.length) {
        await ctx.telegram.sendMessage({
          chat_id: ctx.chatId,
          text: "No models found on the Ollama host for nullptr.",
        });
        return;
      }

      const listStr = models
        .map((m) => (m.name === active ? `* ${m.name} (active)` : `  ${m.name}`))
        .join("\n");

      const responseText = `Installed models for nullptr (NullPointer Bot):\n${listStr}\n\nSwitch active model using: /model <name>`;
      const chunks = splitMessageText(responseText, 4000);

      for (const chunk of chunks) {
        await ctx.telegram.sendMessage({
          chat_id: ctx.chatId,
          text: chunk,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.telegram.sendMessage({
        chat_id: ctx.chatId,
        text: `[nullptr] Error fetching models from ${ctx.llm.getHost()}:\n${message}`,
      });
    }
  }
}
