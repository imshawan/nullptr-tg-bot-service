---
name: add-bot-command
description: >-
  Use this skill when adding or modifying slash commands in nullptr (NullPointer Bot).
  Enforces the Command Pattern, Telegram menu registration, and execution context.
---

# Adding a New Command to nullptr (NullPointer Bot)

Follow this step-by-step workflow to implement a new slash command in nullptr.

---

## 🛠️ Step 1: Implement `ICommandHandler`

Create a new file in `src/services/commands/<command-name>.command.ts`:

```typescript
import { ICommandHandler, CommandContext } from "@/services/commands/command.interface";

export class PingCommand implements ICommandHandler {
  // Command trigger without leading slash (lowercase)
  public readonly command = "ping";

  // Description shown in Telegram autocomplete menu when typing '/'
  public readonly description = "Check bot responsiveness and ping nullptr";

  // Optional alternative triggers
  public readonly aliases = ["p"];

  public async execute(ctx: CommandContext): Promise<void> {
    const startTime = Date.now();
    
    // ctx provides:
    // ctx.chatId, ctx.senderId, ctx.args, ctx.telegram, ctx.llm, ctx.sessionStore, ctx.logger

    await ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: `🏓 Pong from nullptr! (${Date.now() - startTime}ms)`,
    });
  }
}
```

---

## 🔌 Step 2: Register in Composition Root (`src/index.ts`)

Import your command and register it with the `CommandRegistry`:

```typescript
import { PingCommand } from "@/services/commands/ping.command";

// Inside bootstrap():
commandRegistry.register(new PingCommand());
```

---

## ⚡ What Happens Automatically

1. **Telegram Menu Registration**: `BotService.init()` calls `telegram.setMyCommands()`, passing all registered commands to Telegram.
2. **Interactive Autocomplete**: When any user types `/` in Telegram, your new command with its description immediately appears in the popup menu.
3. **Menu Button**: The Telegram client's native Menu button automatically includes your new command.

---

## 🧪 Step 3: Verification

Run verification commands:
```bash
npm run typecheck
npm run build
```
Verify that both commands exit with code 0.
