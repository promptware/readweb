import { ENV } from './env';

export const config = {
  openRouter: {
    apiKey: ENV.OPENROUTER_API_KEY,
    model: ENV.OPENROUTER_MODEL,
  },
  prompts: {
    presetPromptPath: `${process.cwd()}/prompts/prompt1.txt`,
  },
} as const;


