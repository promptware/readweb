import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { config } from '../config';

export const openrouter = createOpenRouter({
  apiKey: config.openRouter.apiKey,
});



