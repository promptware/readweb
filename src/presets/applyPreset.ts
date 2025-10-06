import * as cheerio from 'cheerio';
import { Preset } from '../types/preset';
import { Html, asHtml } from '../types/newtype';

export type ApplyResult =
  | { type: 'preset_match_detectors_failed'; failed_selectors: string[] }
  | { type: 'main_content_selectors_failed'; failed_selectors: string[] }
  | Html;

export async function applyPresetToHtml({ html, preset }: { html: Html; preset: Preset }): Promise<ApplyResult> {
  const $ = cheerio.load(html as unknown as string);

  // 1) Validate all preset_match_detectors hit at least one node
  const failedMatch: string[] = [];
  for (const sel of preset.preset_match_detectors) {
    if ($(sel).length === 0) failedMatch.push(sel);
  }
  if (failedMatch.length > 0) {
    return { type: 'preset_match_detectors_failed', failed_selectors: failedMatch };
  }

  // 2) Collect main content fragments
  const fragments: string[] = [];
  const failedMain: string[] = [];
  for (const sel of preset.main_content_detectors) {
    const nodes = $(sel);
    if (nodes.length === 0) {
      failedMain.push(sel);
      continue;
    }
    nodes.each((_, el) => { fragments.push($.html(el) ?? ''); });
  }
  if (fragments.length === 0) {
    return { type: 'main_content_selectors_failed', failed_selectors: failedMain.length ? failedMain : preset.main_content_detectors };
  }

  // 3) Build a document from fragments and apply filters
  const $doc = cheerio.load(fragments.join('\n'));
  for (const sel of preset.main_content_filters) {
    $doc(sel).remove();
  }

  // 4) Convert to Markdown
  const cleanedHtml = $doc.root().html() ?? '';
  if (!cleanedHtml.trim().length) return asHtml('');
  return asHtml(cleanedHtml);
}


