import * as cheerio from 'cheerio';
import { match } from 'ts-pattern';
import { Preset } from "../types/preset";

// Critical problems (must stop early)
export type CriticalPresetValidationProblem = {
  type: 'preset_match_detectors_did_not_hit_any_node';
  selector: string[];
} | {
  type: 'main_content_selectors_failed';
  selector: string[];
} | {
  type: 'invalid_selectors_detected';
  selector: string[];
};

// Non-critical problems (can proceed but should be fixed)
export type NonCriticalPresetValidationProblem = {
  type: 'nested_selectors_detected_in_main_content_selectors';
  relations: { outer: string; inner: string }[];
} | {
  type: 'nth_child_selectors_detected';
  selector: string[];
} | {
  type: 'contains_pseudo_selector_detected';
  selector: string[];
} | {
  type: 'main_content_filters_do_not_apply_to_main_content';
  selector: string[];
};

export type LLMPresetValidationProblem = | {
  type: 'cryptic_selectors_detected';
  selector: string[];
};

function collectInvalidSelectors(
  { html, selectors }: { html: cheerio.CheerioAPI; selectors: string[] }
): { invalidSelectors: string[]; invalidSelectorSet: Set<string> } {
  const invalidSelectors: string[] = [];
  for (const sel of selectors) {
    try {
      html(sel);
    } catch (e) {
      console.warn('[validatePreset] invalid selector detected', sel, e);
      invalidSelectors.push(sel);
    }
  }
  return { invalidSelectors, invalidSelectorSet: new Set(invalidSelectors) };
}

export function validatePresetCritical(
  { html, preset }: { html: cheerio.CheerioAPI; preset: Preset }
): CriticalPresetValidationProblem[] {
  const allSelectors = [
    ...preset.preset_match_detectors,
    ...preset.main_content_selectors,
    ...preset.main_content_filters,
  ];
  const { invalidSelectors, invalidSelectorSet } = collectInvalidSelectors({ html, selectors: allSelectors });

  const problems: CriticalPresetValidationProblem[] = [];

  // 0) invalid selectors anywhere are critical
  if (invalidSelectors.length > 0) {
    problems.push({ type: 'invalid_selectors_detected', selector: invalidSelectors });
  }

  // 1) preset match detectors must hit at least one node
  const failedPresetSelectors: string[] = [];
  for (const sel of preset.preset_match_detectors) {
    if (invalidSelectorSet.has(sel)) continue;
    if (html(sel).length === 0) failedPresetSelectors.push(sel);
  }
  if (failedPresetSelectors.length > 0) {
    problems.push({ type: 'preset_match_detectors_did_not_hit_any_node', selector: failedPresetSelectors });
  }

  // 2) main content selectors must hit at least one node
  const failedMainContentSelectors: string[] = [];
  for (const sel of preset.main_content_selectors) {
    if (invalidSelectorSet.has(sel)) continue;
    if (html(sel).length === 0) failedMainContentSelectors.push(sel);
  }
  if (failedMainContentSelectors.length > 0) {
    problems.push({ type: 'main_content_selectors_failed', selector: failedMainContentSelectors });
  }

  return problems;
}

export function validatePresetNonCritical(
  { html, preset }: { html: cheerio.CheerioAPI; preset: Preset }
): NonCriticalPresetValidationProblem[] {
  const allSelectors = [
    ...preset.preset_match_detectors,
    ...preset.main_content_selectors,
    ...preset.main_content_filters,
  ];

  const problems: NonCriticalPresetValidationProblem[] = [];

  // A) main_content_filters must apply within at least one main content fragment
  const filtersNotApplying: string[] = [];
  const mainNodes = preset.main_content_selectors
    .flatMap((detector) => html(detector).toArray());
  for (const filter of preset.main_content_filters) {
    let applies = false;
    for (const node of mainNodes) {
      const $node = html(node);
      if ($node.find(filter).length > 0 || $node.filter(filter).length > 0) { applies = true; break; }
    }
    if (!applies) filtersNotApplying.push(filter);
  }
  if (filtersNotApplying.length > 0) {
    problems.push({ type: 'main_content_filters_do_not_apply_to_main_content', selector: filtersNotApplying });
  }

  // B) no nth-child/of-type etc.
  const NTH_REGEX = /:(?:nth-child|nth-last-child|nth-of-type|nth-last-of-type)\s*\(/i;
  const nthLikeSelectors: string[] = [];
  for (const sel of allSelectors) {
    if (NTH_REGEX.test(sel)) nthLikeSelectors.push(sel);
  }
  if (nthLikeSelectors.length > 0) {
    problems.push({ type: 'nth_child_selectors_detected', selector: nthLikeSelectors });
  }

  // C) no :contains pseudo
  const CONTAINS_REGEX = /:contains\s*\(/i;
  const containsPseudoSelectors: string[] = [];
  for (const sel of allSelectors) {
    if (CONTAINS_REGEX.test(sel)) containsPseudoSelectors.push(sel);
  }
  if (containsPseudoSelectors.length > 0) {
    problems.push({ type: 'contains_pseudo_selector_detected', selector: containsPseudoSelectors });
  }

  // D) nested selectors among main_content_selectors (O(n^2))
  const nestedRelations: { outer: string; inner: string }[] = [];
  const seenRelation = new Set<string>();
  for (let i = 0; i < preset.main_content_selectors.length; i++) {
    const selA = preset.main_content_selectors[i];
    for (let j = 0; j < preset.main_content_selectors.length; j++) {
      if (i === j) continue;
      const selB = preset.main_content_selectors[j];
      let foundNested = false;
      const aElems = html(selA).toArray();
      for (const aEl of aElems) {
        const $aEl = html(aEl);
        if ($aEl.find(selB).length > 0 || $aEl.filter(selB).length > 0) {
          const key = `${selA}\u2192${selB}`;
          if (!seenRelation.has(key)) {
            nestedRelations.push({ outer: selA, inner: selB });
            seenRelation.add(key);
          }
          foundNested = true; break;
        }
      }
    }
  }
  if (nestedRelations.length > 0) {
    // Sort: direct relations first, transitive later
    const idxByKey = new Map<string, number>();
    nestedRelations.forEach((r, i) => idxByKey.set(`${r.outer}\u2192${r.inner}`, i));
    const hasEdge = (a: string, b: string) => idxByKey.has(`${a}\u2192${b}`);
    const isTransitive = (r: { outer: string; inner: string }) =>
      preset.main_content_selectors.some((mid) => mid !== r.outer && mid !== r.inner && hasEdge(r.outer, mid) && hasEdge(mid, r.inner));
    const sorted = [...nestedRelations].sort((ra, rb) => {
      const ta = isTransitive(ra) ? 1 : 0;
      const tb = isTransitive(rb) ? 1 : 0;
      if (ta !== tb) return ta - tb;
      // preserve insertion order for ties
      return (idxByKey.get(`${ra.outer}\u2192${ra.inner}`) ?? 0) - (idxByKey.get(`${rb.outer}\u2192${rb.inner}`) ?? 0);
    });
    problems.push({ type: 'nested_selectors_detected_in_main_content_selectors', relations: sorted });
  }

  return problems;
}

export function renderCriticalPresetValidationProblems(
  problems: CriticalPresetValidationProblem[]
): string {
  if (problems.length === 0) return '';
  const lines: string[] = [];
  for (const problem of problems) {
    const text = match(problem)
      .with({ type: 'invalid_selectors_detected' }, (p) => {
        return `- These selectors are syntactically invalid or unsupported: ${p.selector.join(', ')}. Fix unmatched parentheses, typos, or remove unsupported pseudo-selectors.`;
      })
      .with({ type: 'preset_match_detectors_did_not_hit_any_node' }, (p) => {
        return `- These preset match selectors matched nothing: ${p.selector.join(', ')}. Choose stable site-wide elements (e.g., header, nav, footer) that exist across pages.`;
      })
      .with({ type: 'main_content_selectors_failed' }, (p) => {
        return `- These main content selectors matched nothing: ${p.selector.join(', ')}. Target the container that holds the readable article or body content.`;
      })
      .exhaustive();
    lines.push(text);
  }
  return lines.join('\n');
}

export function renderNonCriticalPresetValidationProblems(
  problems: NonCriticalPresetValidationProblem[]
): string {
  if (problems.length === 0) return '';
  const lines: string[] = [];
  for (const problem of problems) {
    const text = match(problem)
      .with({ type: 'main_content_filters_do_not_apply_to_main_content' }, (p) => {
        return `- These filters do not match within the selected main content: ${p.selector.join(', ')}. Remove them or scope them to elements inside the main content.`;
      })
      .with({ type: 'nth_child_selectors_detected' }, (p) => {
        return `- Avoid nth-child/of-type in these selectors: ${p.selector.join(', ')}. The DOM structure can change; prefer stable attributes or classes.`;
      })
      .with({ type: 'contains_pseudo_selector_detected' }, (p) => {
        return `- Avoid :contains(...) in these selectors: ${p.selector.join(', ')}. Prefer structural or attribute-based targeting.`;
      })
      .with({ type: 'nested_selectors_detected_in_main_content_selectors' }, (p) => {
        const relations = p.relations.map((r) => `${r.outer} → ${r.inner}`).join('; ');
        return `- Some main content selectors are nested within others: ${relations}. Use a single parent-level selector to avoid duplication and brittleness.`;
      })
      .exhaustive();
    lines.push(text);
  }
  return lines.join('\n');
}