import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findEnvPath(startDir: string): string | null {
  let current = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.resolve(current, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

const envPath = findEnvPath(__dirname);
if (envPath) dotenv.config({ path: envPath });

const EnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().min(1),
  FIRECRAWL_API_KEY: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema>;

function readEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid/missing environment variables:\n${errors}`);
  }
  return parsed.data;
}

export const ENV = readEnv();