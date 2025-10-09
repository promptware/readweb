import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { match } from 'ts-pattern';
import { FixtureSchema } from '../types/fixture';
import { useReadability } from '../readability/useReadability';

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: pnpm tsx src/scripts/readabilityCleanFixture.ts <path/to/fixture.json>');
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

  const { html, url } = parsed.data;
  const result = await useReadability({ html, url });

  match(result)
    .with({ type: 'ok' }, ({ markdown, meta }) => {
      console.log('\n=== Readability Markdown ===\n');
      console.log(markdown);
      console.log('\n=== Meta ===');
      console.log(JSON.stringify(meta, null, 2));
    })
    .with({ type: 'not_applicable' }, () => {
      console.log('Readability: not applicable for this document.');
      process.exitCode = 2;
    })
    .with({ type: 'failed_to_apply' }, () => {
      console.log('Readability: failed to apply to this document.');
      process.exitCode = 3;
    })
    .exhaustive();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


