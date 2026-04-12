import Anthropic from "@anthropic-ai/sdk";

  export const anthropic = new Anthropic({
    apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || "",
    baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL || "https://api.anthropic.com",
  });
  