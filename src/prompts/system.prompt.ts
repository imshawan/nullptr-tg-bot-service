import { DEFAULT_BOT_NAME } from "@/prompts/prompt.constants";
import { getPersonaPrompt } from "@/prompts/persona.prompt";
import { MEDIA_DOWNLOADER_INSTRUCTIONS } from "@/prompts/downloader.prompt";
import { USER_IDENTITY_INSTRUCTIONS } from "@/prompts/identity.prompt";
import { MATURE_TOPIC_INSTRUCTIONS } from "@/prompts/mature.prompt";

/**
 * Composes the default complete system prompt.
 */
export function buildDefaultSystemPrompt(
  botName: string = DEFAULT_BOT_NAME,
  allowMatureContent: boolean = true
): string {
  const sections: string[] = [
    getPersonaPrompt(botName),
    "",
    USER_IDENTITY_INSTRUCTIONS,
  ];

  if (allowMatureContent) {
    sections.push("", MATURE_TOPIC_INSTRUCTIONS);
  }

  sections.push("", MEDIA_DOWNLOADER_INSTRUCTIONS);

  return sections.join("\n");
}

export const DEFAULT_SYSTEM_PROMPT = buildDefaultSystemPrompt(DEFAULT_BOT_NAME, true);

/**
 * Builds the full system prompt, ensuring required directives (identity, mature scope & downloader)
 * are present even if a custom prompt is provided via environment variables.
 */
export function buildFullSystemPrompt(
  customPrompt?: string,
  botName: string = DEFAULT_BOT_NAME,
  allowMatureContent: boolean = true
): string {
  let prompt = customPrompt || buildDefaultSystemPrompt(botName, allowMatureContent);

  if (!prompt.includes("USER IDENTITY & CONTEXT:")) {
    prompt = `${prompt}\n\n${USER_IDENTITY_INSTRUCTIONS}`;
  }

  if (allowMatureContent) {
    if (!prompt.includes("MATURE & ADULT CONVERSATION DIRECTIVES:")) {
      prompt = `${prompt}\n\n${MATURE_TOPIC_INSTRUCTIONS}`;
    }
  } else {
    // If disabled, strip mature directives if present in default or custom prompt
    if (prompt.includes("MATURE & ADULT CONVERSATION DIRECTIVES:")) {
      prompt = prompt
        .replace(/\n\nMATURE & ADULT CONVERSATION DIRECTIVES:[\s\S]*?(?=\n\nCAPABILITIES & MEDIA DOWNLOADS:|$)/, "")
        .trim();
    }
  }

  if (!prompt.includes("[DOWNLOAD:")) {
    prompt = `${prompt}\n\n${MEDIA_DOWNLOADER_INSTRUCTIONS}`;
  }

  return prompt;
}
