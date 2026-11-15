import { TelegramUser } from "@/domain/telegram/telegram.types";
import { DEFAULT_BOT_NAME, CREATOR_NAME, CREATOR_EMAIL, CREATOR_USERNAME } from "@/prompts/prompt.constants";
import { buildTemporalPrompt } from "@/prompts/temporal.prompt";

/**
 * Instructions embedded in the system prompt guiding the model on how to handle user identity.
 */
export const USER_IDENTITY_INSTRUCTIONS = `USER IDENTITY & CONTEXT:
You will receive context metadata about the current Telegram user talking to you in a [CURRENT USER INFORMATION] block.
When the user asks "who am I?", "what is my name?", "do you know me?", or questions about their identity:
- Use the provided user information (their name, username, Telegram ID, and role).
- If the user is identified as your creator/maintainer (${CREATOR_NAME}), warmly greet and recognize them as your creator and maintainer.
- Never state that you do not know who they are or that you have no access to their identity, because their Telegram profile information is provided to you.`;

/**
 * Checks whether a Telegram user is the creator and maintainer (Shawan Mandal).
 */
export function isCreator(user?: TelegramUser): boolean {
  if (!user) return false;
  const username = user.username?.toLowerCase().replace(/^@/, "");
  if (username === CREATOR_USERNAME.toLowerCase()) return true;

  const fullName = `${user.first_name || ""} ${user.last_name || ""}`.toLowerCase();
  if (fullName.includes("shawan")) return true;

  return false;
}

/**
 * Formats a Telegram user's display name.
 */
export function formatUserFullName(user?: TelegramUser): string {
  if (!user) return "Unknown User";
  const parts = [user.first_name, user.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : user.username ? `@${user.username}` : `User ${user.id}`;
}

/**
 * Builds user context metadata to inject into LLM system messages so the model is aware of who it is talking to.
 */
export function buildUserContextPrompt(user?: TelegramUser, botName: string = DEFAULT_BOT_NAME): string {
  if (!user) {
    return `[CURRENT USER INFORMATION]\n- User: Unknown / Anonymous`;
  }

  const creator = isCreator(user);
  const fullName = formatUserFullName(user);
  const username = user.username ? `@${user.username}` : "none";

  if (creator) {
    return [
      `[CURRENT USER INFORMATION]`,
      `- Name: ${fullName}`,
      `- Username: ${username}`,
      `- Telegram ID: ${user.id}`,
      `- Role: Creator, Author & Maintainer of ${botName} (${CREATOR_NAME} - ${CREATOR_EMAIL})`,
      `- Note: This user created and manages you. If they ask about their identity, who they are, or their relationship to you, address them respectfully as your creator/maintainer (${CREATOR_NAME}).`,
    ].join("\n");
  }

  return [
    `[CURRENT USER INFORMATION]`,
    `- Name: ${fullName}`,
    `- Username: ${username}`,
    `- Telegram ID: ${user.id}`,
    `- Role: Authorized User`,
    `- Note: If this user asks about their identity or who they are, address them by their name (${fullName}) and username (${username}).`,
  ].join("\n");
}

/**
 * Builds composite real-time dynamic context (user metadata + temporal situational awareness).
 */
export function buildDynamicContextPrompt(
  user?: TelegramUser,
  botName: string = DEFAULT_BOT_NAME,
  timeZone: string = "Asia/Kolkata",
  date: Date = new Date()
): string {
  return [
    buildUserContextPrompt(user, botName),
    buildTemporalPrompt(date, timeZone),
  ].join("\n\n");
}
