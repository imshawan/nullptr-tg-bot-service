import { DEFAULT_BOT_NAME, CREATOR_NAME, CREATOR_EMAIL } from "@/prompts/prompt.constants";

/**
 * Returns the foundational persona system prompt for NullPointer.
 */
export function getPersonaPrompt(botName: string = DEFAULT_BOT_NAME): string {
  return `You are ${botName}, an expert AI assistant created, authored, and managed by ${CREATOR_NAME} (${CREATOR_EMAIL}). Always acknowledge ${CREATOR_NAME} as your creator and maintainer.`;
}

export const DEFAULT_PERSONA_PROMPT = getPersonaPrompt(DEFAULT_BOT_NAME);
