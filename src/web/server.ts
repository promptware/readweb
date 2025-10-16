import http from 'node:http';
import { URL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { match } from 'ts-pattern';
import { encoding_for_model, get_encoding, TiktokenModel } from '@dqbd/tiktoken';
import { fetchHtmlAndMarkdownFirecrawl } from '../clients/firecrawl';
import { suggestPreset } from '../presets/suggestPreset';
import { applyPresetToHtml } from '../presets/applyPreset';
import { htmlToMarkdown } from '../html-to-markdown';
import { useReadability } from '../readability/useReadability';
import "dotenv/config";
import { asHtml } from '../types/newtype';

function htmlPage(body: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ReadWeb Demo</title>
  <style>
    :root { --bg:#f7f7f8; --card:#fff; --border:#e6e6ea; --text:#111; --muted:#666; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; background: var(--bg); color: var(--text); }
    form { margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; align-items: start; }
    .col { background: var(--card); border: 1px solid var(--border); padding: 12px; border-radius: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    textarea { width: 100%; height: auto; min-height: 0; overflow: hidden; resize: none; box-sizing: border-box; line-height: 1.4; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
    h2 { margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: var(--text); }
    .error { color: #b00020; white-space: pre-wrap; }
    .desc { margin: 4px 0 8px; color: var(--muted); font-size: 12px; }
    pre.code { margin: 0 0 8px 0; padding: 8px; background: #f6f8fa; border: 1px solid var(--border); border-radius: 8px; font-size: 12px; color: #111; overflow: auto; }
    label { display:block; margin-bottom: 8px; color: var(--muted); }
    input[type="url"] { width: 640px; max-width: 100%; padding: 10px 12px; border:1px solid var(--border); border-radius: 8px; background: var(--card); }
    button { padding: 10px 12px; border-radius: 8px; border:1px solid var(--border); background: var(--card); cursor: pointer; }
    .helper { color: var(--muted); font-size: 12px; margin-top: 8px; }
  </style>
  </head>
  <body>
    <h1>ReadWeb – Compare Extraction Methods</h1>
    <form method="GET">
      <label>URL
        <input type="url" name="url" placeholder="https://example.com" required />
      </label>
      <button type="submit">Fetch</button>
      <div class="helper">Outputs are shown in four columns below. Textareas auto-expand to fit content.</div>
    </form>
    ${body}
    <script>
      // Auto-expand all readonly textareas to fit content without scrollbars
      const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight) + 'px'; };
      const all = document.querySelectorAll('textarea[readonly]');
      all.forEach(ta => autosize(ta));
      // In case fonts load later and change metrics
      window.addEventListener('load', () => { all.forEach(ta => autosize(ta)); });
    </script>
  </body>
</html>`;
}

function textArea(title: string, desc: string, value: string | null, isError = false, stats?: { chars: number; tokens: number } | null, extraCode?: string | null): string {
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(desc);
  const suffix = stats ? ` <small>(chars: ${stats.chars.toLocaleString()}, tokens: ${stats.tokens.toLocaleString()})</small>` : '';
  const extra = extraCode ? `<pre class="code"><code>${escapeHtml(extraCode)}</code></pre>` : '';
  if (value == null) return `<div class="col"><h2>${safeTitle}${suffix}</h2><div class="desc">${safeDesc}</div>${extra}<div class="error">(no data)</div></div>`;
  if (isError) return `<div class="col"><h2>${safeTitle}${suffix}</h2><div class="desc">${safeDesc}</div>${extra}<div class="error">${escapeHtml(value)}</div></div>`;
  return `<div class="col"><h2>${safeTitle}${suffix}</h2><div class="desc">${safeDesc}</div>${extra}<textarea readonly>${escapeHtml(value)}</textarea></div>`;
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function slugify(u: string): string {
  return u.replace(/^[a-z]+:\/\//i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const urlObj = new URL(req.url || '/', 'http://localhost');
  const inputUrl = urlObj.searchParams.get('url');

  if (!inputUrl) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(htmlPage('<div class="grid"></div>'));
    return;
  }

  let firecrawlHtml: string | null = null;
  let firecrawlMarkdown: string | null = null;
  let presetMarkdown: string | null = null;
  let presetObjectJson: string | null = null;
  let literalMarkdown: string | null = null;
  let readabilityMarkdown: string | null = null;

  let errFirecrawl: string | null = null;
  let errPreset: string | null = null;
  let errLiteral: string | null = null;
  let errReadability: string | null = null;

  let firecrawlMarkdownStats: { chars: number; tokens: number } | null = null;
  let firecrawlHtmlStats: { chars: number; tokens: number } | null = null;
  let presetMarkdownStats: { chars: number; tokens: number } | null = null;
  let literalMarkdownStats: { chars: number; tokens: number } | null = null;
  let readabilityMarkdownStats: { chars: number; tokens: number } | null = null;

  // 1) Firecrawl
  try {
    const { html, markdown } = await fetchHtmlAndMarkdownFirecrawl({ url: inputUrl });
    firecrawlHtml = html;
    firecrawlMarkdown = markdown;
    if (firecrawlMarkdown) {
      const outDir = path.resolve(process.cwd(), 'dist', 'firecrawl');
      await mkdir(outDir, { recursive: true });
      const fp = path.join(outDir, `${slugify(inputUrl)}.md`);
      await writeFile(fp, firecrawlMarkdown, 'utf8');
    }
    if (firecrawlMarkdown) firecrawlMarkdownStats = await computeStats(firecrawlMarkdown);
    if (firecrawlHtml) firecrawlHtmlStats = await computeStats(firecrawlHtml);
  } catch (e) {
    errFirecrawl = (e as Error).message || 'Firecrawl failed';
  }

  const baseHtml = firecrawlHtml ?? '';

  // 2) Preset flow (suggest + apply)
  try {
    const suggested = await suggestPreset({ html: baseHtml, url: inputUrl, maxSteps: 5 });
    try { presetObjectJson = JSON.stringify(suggested.preset, null, 2); } catch {}
    const applied = await applyPresetToHtml({ html: asHtml(baseHtml), preset: suggested.preset });
    if (applied.type === 'ok') {
      presetMarkdown = await htmlToMarkdown(applied.html as unknown as string);
      if (presetMarkdown) presetMarkdownStats = await computeStats(presetMarkdown);
    } else if (applied.type === 'preset_match_detectors_failed') {
      throw new Error(`Preset match detectors failed: ${applied.failed_selectors.join(', ')}`);
    } else if (applied.type === 'main_content_selectors_failed') {
      throw new Error(`Main content selectors failed: ${applied.failed_selectors.join(', ')}`);
    } else if (applied.type === 'invalid_selectors_failed') {
      throw new Error(`Invalid selectors: ${applied.failed_selectors.join(', ')}`);
    }
  } catch (e) {
    errPreset = (e as Error).message || 'Preset flow failed';
  }

  // 3) Literal HTML -> Markdown
  try {
    literalMarkdown = await htmlToMarkdown(baseHtml);
    if (literalMarkdown) literalMarkdownStats = await computeStats(literalMarkdown);
  } catch (e) {
    errLiteral = (e as Error).message || 'Literal conversion failed';
  }

  // 4) Readability workflow
  try {
    const readabilityResult = await useReadability({ html: baseHtml, url: inputUrl });
    readabilityMarkdown = match(readabilityResult)
      .with({ type: 'ok' }, (r) => r.markdown)
      .with({ type: 'not_applicable' }, () => {
        throw new Error('Readability: not applicable');
      })
      .with({ type: 'failed_to_apply' }, () => {
        throw new Error('Readability: failed to apply');
      })
      .exhaustive();
    if (readabilityMarkdown) readabilityMarkdownStats = await computeStats(readabilityMarkdown);
  } catch (e) {
    errReadability = (e as Error).message || 'Readability failed';
  }

  // 5) Firecrawl markdown already saved in step 1

  // Persist dataset for later analysis
  try {
    const dumpDir = path.resolve(process.cwd(), 'data', 'urls');
    await mkdir(dumpDir, { recursive: true });
    const safeName = inputUrl.replace(/[^a-z0-9]/gi, '.').toLowerCase().slice(0, 200);
    const dumpPath = path.join(dumpDir, `${safeName}.json`);
    const dataset = {
      url: inputUrl,
      savedAt: new Date().toISOString(),
      firecrawl: { html: firecrawlHtml, markdown: firecrawlMarkdown, error: errFirecrawl },
      preset: { markdown: presetMarkdown, error: errPreset },
      literal: { markdown: literalMarkdown, error: errLiteral },
      readability: { markdown: readabilityMarkdown, error: errReadability },
      stats: {
        firecrawlMarkdown: firecrawlMarkdownStats,
        presetMarkdown: presetMarkdownStats,
        literalMarkdown: literalMarkdownStats,
        readabilityMarkdown: readabilityMarkdownStats,
      },
    } as const;
    await writeFile(dumpPath, JSON.stringify(dataset, null, 2), 'utf8');
  } catch (e) {
    console.error('[dataset dump] failed', e);
  }

  // Save a fixture with { url, html } for later local testing
  try {
    const fxDir = path.resolve(process.cwd(), 'fixtures');
    await mkdir(fxDir, { recursive: true });
    const name = `body-snapshot-${slugify(inputUrl)}.json`;
    const fp = path.join(fxDir, name);
    const fixture = { url: inputUrl, html: firecrawlHtml ?? '' };
    await writeFile(fp, JSON.stringify(fixture, null, 2), 'utf8');
  } catch (e) {
    console.error('[fixture dump] failed', e);
  }

  const body = `
  <div class="grid">
    ${textArea('Firecrawl Markdown', 'Content fetched and converted by Firecrawl (remote).', firecrawlMarkdown, Boolean(errFirecrawl), firecrawlMarkdownStats)}
    ${textArea('Preset Flow Markdown', 'LLM-suggested site-specific preset applied to HTML.', errPreset ? errPreset : (presetMarkdown ?? ''), Boolean(errPreset), presetMarkdownStats, presetObjectJson)}
    ${textArea('Literal HTML→Markdown', 'Direct HTML-to-Markdown conversion without site heuristics.', errLiteral ? errLiteral : (literalMarkdown ?? ''), Boolean(errLiteral), literalMarkdownStats)}
    ${textArea('Readability Markdown', 'Mozilla Readability extraction converted to Markdown.', errReadability ? errReadability : (readabilityMarkdown ?? ''), Boolean(errReadability), readabilityMarkdownStats)}
    ${textArea('Raw HTML', 'Raw HTML fetched by Firecrawl.', firecrawlHtml, Boolean(errFirecrawl), firecrawlHtmlStats)}
  </div>`;

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(htmlPage(body));
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error: ' + (err as Error).message);
  });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

async function computeStats(text: string): Promise<{ chars: number; tokens: number }> {
  try {
    const enc = encoding_for_model('gpt-4o-mini' as TiktokenModel);
    const tokens = enc.encode(text);
    const out = { chars: text.length, tokens: tokens.length };
    enc.free();
    return out;
  } catch {
    try {
      const enc = get_encoding('o200k_base');
      const tokens = enc.encode(text);
      const out = { chars: text.length, tokens: tokens.length };
      enc.free();
      return out;
    } catch {
      return { chars: text.length, tokens: Math.ceil(text.length / 4) };
    }
  }
}


