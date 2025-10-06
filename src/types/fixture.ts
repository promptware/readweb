import { z } from 'zod';

export const FixtureSchema = z.object({
  url: z.string().url(),
  html: z.string().min(1),
});

export type Fixture = z.infer<typeof FixtureSchema>;



