import { DEFAULT_BOT_NAME } from "@/prompts/prompt.constants";
import { getPersonaPrompt } from "@/prompts/persona.prompt";
import { MEDIA_DOWNLOADER_INSTRUCTIONS } from "@/prompts/downloader.prompt";
import { USER_IDENTITY_INSTRUCTIONS } from "@/prompts/identity.prompt";

/**
 * Composes the default complete system prompt.
 */
export function buildDefaultSystemPrompt(botName: string = DEFAULT_BOT_NAME): string {
  return [
    getPersonaPrompt(botName),
    "",
    USER_IDENTITY_INSTRUCTIONS,
    "",
    MEDIA_DOWNLOADER_INSTRUCTIONS,
  ].join("\n");
}

export const DEFAULT_SYSTEM_PROMPT = buildDefaultSystemPrompt(DEFAULT_BOT_NAME);

/**
 * Builds the full system prompt, ensuring required directives (identity & downloader)
 * are present even if a custom prompt is provided via environment variables.
 */
export function buildFullSystemPrompt(customPrompt?: string, botName: string = DEFAULT_BOT_NAME): string {
  let prompt = customPrompt || buildDefaultSystemPrompt(botName);

  if (!prompt.includes("USER IDENTITY & CONTEXT:")) {
    prompt = `${prompt}\n\n${USER_IDENTITY_INSTRUCTIONS}`;
  }

  if (!prompt.includes("[DOWNLOAD:")) {
    prompt = `${prompt}\n\n${MEDIA_DOWNLOADER_INSTRUCTIONS}`;
  }

  return prompt;
}
