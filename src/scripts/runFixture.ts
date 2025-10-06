import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { FixtureSchema } from '../types/fixture';
import { suggestPreset } from '../presets/suggestPreset';

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: pnpm tsx src/scripts/runFixture.ts <path/to/fixture.json>');
    process.exit(1);
  }
  const p = resolve(process.cwd(), fileArg);
  const raw = await readFile(p, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    console.error('Invalid JSON in fixture:', (e as Error).message);
    process.exit(1);
  }
  const parsed = FixtureSchema.safeParse(json);
  if (!parsed.success) {
    console.error('Invalid fixture JSON:', parsed.error.flatten());
    console.error('Must be of format: { "url": "https://example.com", "html": "<html>...</html>" }');
    process.exit(1);
  }

  const { html } = parsed.data;
  const result = await suggestPreset({ html });
  console.log('\n=== Final Markdown ===\n');
  console.log(result.markdown);
  console.log('\n=== Preset ===\n');
  console.log(JSON.stringify(result.preset, null, 2));
  console.log('\nAccepted:', result.accepted);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


