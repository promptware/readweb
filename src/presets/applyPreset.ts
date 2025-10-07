import * as cheerio from 'cheerio';
import { Preset } from '../types/preset';
import { Html, asHtml } from '../types/newtype';
import { validatePresetCritical } from './validatePreset';

export type ApplyResult =
  | { type: 'preset_match_detectors_failed'; failed_selectors: string[] }
  | { type: 'main_content_selectors_failed'; failed_selectors: string[] }
  | { type: 'invalid_selectors_failed'; failed_selectors: string[] }
  | { type: 'ok'; html: Html };

export async function applyPresetToHtml({ html, preset }: { html: Html; preset: Preset }): Promise<ApplyResult> {
  const $ = cheerio.load(html as unknown as string);

  // Critical validation first
  const criticalProblems = validatePresetCritical({ html: $, preset });
  if (criticalProblems.length > 0) {
    // Prioritize invalid selectors, then preset match, then main content selectors
    const invalid = criticalProblems.find((p) => p.type === 'invalid_selectors_detected');
    if (invalid && 'selector' in invalid) {
      return { type: 'invalid_selectors_failed', failed_selectors: invalid.selector };
    }
    const presetFailed = criticalProblems.find((p) => p.type === 'preset_match_detectors_did_not_hit_any_node');
    if (presetFailed && 'selector' in presetFailed) {
      return { type: 'preset_match_detectors_failed', failed_selectors: presetFailed.selector };
    }
    const mainFailed = criticalProblems.find((p) => p.type === 'main_content_selectors_failed');
    if (mainFailed && 'selector' in mainFailed) {
      return { type: 'main_content_selectors_failed', failed_selectors: mainFailed.selector };
    }
  }

  // If validation passed, proceed unsafely
  return applyPresetToHtmlUnsafe({ html, preset });
}

export async function applyPresetToHtmlUnsafe({ html, preset }: { html: Html; preset: Preset }): Promise<ApplyResult> {
  const $ = cheerio.load(html as unknown as string);
  const fragments: string[] = [];
  for (const sel of preset.main_content_selectors) {
    const nodes = $(sel);
    nodes.each((_, el) => { fragments.push($.html(el) ?? ''); });
  }
  const $doc = cheerio.load(fragments.join('\n'));
  for (const sel of preset.main_content_filters) {
    $doc(sel).remove();
  }
  const cleanedHtml = $doc.root().html() ?? '';
  return { type: 'ok', html: asHtml(cleanedHtml) };
}


