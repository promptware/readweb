import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { ENV } from '../env';

export const openrouter = createOpenRouter({
  apiKey: ENV.OPENROUTER_API_KEY,
});



