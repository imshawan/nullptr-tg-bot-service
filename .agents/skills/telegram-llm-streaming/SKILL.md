---
name: telegram-llm-streaming
description: >-
  Use this skill to understand, debug, or modify nullptr's Telegram long-polling,
  message streaming pipeline, throttled message editing, context window management,
  and mapping from legacy bot.mjs.
---

# NullPointer — Streaming & Core Bot Operations

This skill documents the end-to-end operational pipeline of **NullPointer**, including the exact translation of the original single-file `bot.mjs` into our enterprise modular architecture.

---

## 🗺️ Original `bot.mjs` to Modular Architecture Mapping

If you or another LLM need to locate or trace a feature from the original `bot.mjs`, refer to this exact mapping:

| Original `bot.mjs` Component | Modular TypeScript Component | File Path |
|---|---|---|
| `tgRequest()` | `TelegramClient.request()` | `src/domain/telegram/telegram.client.ts` |
| `splitText()`, `sendChunkedMessage()` | `splitMessageText()`, `deliverMessage()` | `src/utils/text.utils.ts` & `src/services/bot.service.ts` |
| `listOllamaModels()` | `OllamaProvider.listModels()` | `src/domain/llm/ollama.provider.ts` |
| `streamOllamaChat()` | `OllamaProvider.chatStream()` + `BotService.streamLlmReply()` | `src/domain/llm/ollama.provider.ts` & `src/services/bot.service.ts` |
| `handleCommand()` | `CommandRegistry.dispatch()` + individual command classes | `src/services/command.registry.ts` & `src/services/commands/` |
| `chatHistory` Map | `InMemorySessionStore` (`ISessionStore`) | `src/domain/session/in-memory-session.store.ts` |
| `processUpdate()` | `BotService.processUpdate()` | `src/services/bot.service.ts` |
| `pollLoop()` | `BotService.start()` | `src/services/bot.service.ts` |
| Per-chat update queue | `KeyedAsyncQueue` | `src/core/queue/keyed-async-queue.ts` |
| System prompt & personas | Modular prompt engineering subsystem | `src/prompts/` (`@/prompts`) |
| Top-level environment vars | Centralized `getConfig*()` functions | `src/config/index.ts` |

---

## 🌊 Complete Lifecycle of an Incoming Message

When an update arrives from Telegram via `getUpdates`:

```mermaid
flowchart TD
    Update[Telegram Update Received] --> Route[Resolve Partition Key: chatId]
    Route --> Enqueue[KeyedAsyncQueue.enqueue]
    Enqueue -->|Different Chats: Parallel| Process[processUpdate]
    Enqueue -->|Same Chat: Strict FIFO| Process
    Process --> Auth{Authorized User?}
    Auth -- No --> Deny[Send 403 Access Denied Message]
    Auth -- Yes --> IsCommand{Starts with '/'?}
    IsCommand -- Yes --> Dispatch[CommandRegistry.dispatch]
    IsCommand -- No --> Session[Append User Message to SessionStore]
    Session --> Trim[Trim History to MAX_HISTORY_MESSAGES]
    Trim --> Stream[BotService.streamLlmReply]
    Stream --> Heartbeat[Send 'typing' Action Heartbeat every 4.5s]
    Stream --> Placeholder[Send 'NullPointer is thinking...' Placeholder]
    Stream --> Consume[Consume OllamaProvider.chatStream Async Generator]
    Consume --> Throttle{Elapsed >= ThrottleMs?}
    Throttle -- Yes --> Edit[editMessageText with Cursor ▍]
    Throttle -- No --> Buffer[Accumulate in Buffer]
    Consume -- Done --> FinalDelivery[deliverMessage: Markdown with Plain-Text Fallback]
    FinalDelivery --> AppendAssistant[Append Assistant Message to SessionStore]
```

---

## ⚙️ Critical Invariants of the Streaming Engine

### 1. Per-Chat Asynchronous Serialization (`KeyedAsyncQueue`)
- To prevent one user's slow LLM stream or long media download from blocking other users, updates are routed through `KeyedAsyncQueue` partitioned by `chatId`.
- **Different chats** execute concurrently in parallel without waiting.
- **The same chat** executes strictly in FIFO sequence: subsequent messages or commands from that chat wait until previous messages finish, preventing race conditions in `sessionStore` and out-of-order Telegram replies.
- When a chat's queue becomes idle, its queue entry is automatically purged from memory.

```mermaid
flowchart TD
    Poll["Telegram getUpdates Loop"] -->|"Non-blocking dispatch"| Router["Queue Router (chatId)"]
    Router -->|"chatId = User A"| QueueA["User A FIFO Queue"]
    Router -->|"chatId = User B"| QueueB["User B FIFO Queue"]
    Router -->|"chatId = User N"| QueueN["User N FIFO Queue"]
    QueueA -->|"Worker A"| ExecA["Ollama Stream / Download"]
    QueueB -->|"Worker B"| ExecB["Instant Command / LLM Stream"]
    QueueN -->|"Worker N"| ExecN["Independent Chat Flow"]
```

### 2. The Dynamic Edit Throttle (Rate-Limit Backoff)
- Telegram enforces aggressive rate limits on message editing in private and group chats.
- Never decrease `STREAM_EDIT_INTERVAL_MS` below `1000ms`. The default is `1200ms`.
- If Telegram returns HTTP 429 (`TOO_MANY_REQUESTS`), `BotService` dynamically reads the `retry_after` parameter and delays the next edit accordingly.

### 3. Typing Indicator Heartbeat
- Telegram automatically dismisses the `"typing..."` chat header after 5 seconds.
- While the remote LLM on Oracle Cloud processes the prompt before returning its first token, `BotService` maintains an active heartbeat timer (`setInterval` every 4500ms) to ensure the user knowsNullPointeris working.
- As soon as the first stream chunk arrives, the heartbeat interval is immediately cleared.

### 4. Cursor Effect
- While streaming, edits append an animated terminal cursor `▍`:
  ```typescript
  const previewText = `${fullContent} ▍`;
  ```
- The final message removes the cursor.

### 4. Resilient Markdown Delivery
- Raw LLM streaming output often contains unclosed markdown tags (e.g. unclosed backticks or asterisks).
- Therefore, intermediate edits are sent without `parse_mode` to prevent Telegram entity parsing errors.
- The final message attempts `parse_mode: "Markdown"`. If Telegram throws an entity parsing error, it automatically falls back to plain text so messages are **never lost**.

### 5. Smart Splitting Over 4000 Characters
- Telegram messages have a strict limit of 4096 characters.
- If the LLM response exceeds 4000 characters:
  1. The existing placeholder is edited to display Chunk 1.
  2. Any remaining chunks are sent sequentially using `sendMessage()`.
  3. Text splitting prioritizes paragraph breaks (`\n\n`), newlines (`\n`), and spaces (` `) to prevent splitting words or code mid-token.

### 6. Context Memory & Model Switch Reset
- Conversation history is trimmed to `MAX_HISTORY_MESSAGES` (default 20) on every turn.
- When a user switches models using `/model <target>`, `ctx.sessionStore.clearHistory(chatId)` is **always called** to prevent context contamination across different model architectures.

### 7. User Authorization & Security Gate
- Access control is governed by `ALLOWED_USER_IDS` in `.env`.
- Supports 1 or more comma-separated Telegram usernames (e.g. `uxyg4nry4,xnhweeh`), numeric IDs (e.g. `12345678,87654321`), or a combination.
- Usernames are matched case-insensitively with leading `@` stripped.
- Both incoming text messages (`processUpdate`) and callback queries (`handleCallbackQuery`) are evaluated against the authorized set.
- If `ALLOWED_USER_IDS` is omitted or empty, access is unrestricted.
