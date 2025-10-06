import { readFile } from 'fs/promises';
import { z } from 'zod';
import { generateText, stepCountIs } from 'ai';
import { openrouter } from '../clients/ai';
import { config } from '../config';
import { Preset, PresetSchema } from '../types/preset';
import { applyPresetToHtml, ApplyResult } from './applyPreset';
import { asHtml } from '../types/newtype';
import { match } from 'ts-pattern';
import { htmlToMarkdown } from '../html-to-markdown';
import { cleanupToCheerio } from '../dom/cleanup';
import { formatHtml } from '../dom/format';

export interface SuggestPresetResult {
  preset: Preset;
  markdown: string;
  accepted: boolean;
}

const systemPrompt = `
# Overall system overview

To give you overall contenxt of what is happening, you are a part of a larger system, the goal of which is to transform pages into readable "main content" excerpts. 

It does so by using Presets tailored for particular websites.

\`\`\`ts
type CSSSelector = string;

interface Preset {
  preset_match_detectors: CSSSelector[];
  main_content_detectors: CSSSelector[];
  main_content_filters: CSSSelector[];
}
\`\`\`

The system accepts URLs, reads their HTML contents, fetches existing presets from the database for a given URL, and goes over the list of them until it finds the first matching one.

If there is no preset, it falls back to calling an LLM tool to generate one, which is actually your [Task](#Task).

## \`preset_match_detectors\`

\`preset_match_detectors\` are selectors that capture unique page characteristics that are LIKELY to be present on other webpages of this website with similar layout.

The goal of \`preset_match_detectors\` is to increase accuracy of preset choice: if we stumble upon a page with a layout we are seeing for the first time, we should rather avoid using the same preset and generate a new one.
\`preset_match_detectors\` helps to narrow down the set of "allowed" page layouts the preset is applicable to.


\`preset_match_detectors\` include, but are not limited to:

- navigation bar elements
- footers
- headers
- website logos
- sidebars
- profile buttons
- login / logout buttons

## \`main_content_detectors\`

These are CSS selectors used to capture the main human-readable content. Multiple selectors are allowed.

## \`main_content_filters\`

Filters can be used to "exclude" certain elements from the main content, like:
- ads
- banners
- popups
- sponsored content
- distractions
- tables of contents
- cookie consent banners
- modals
- paywall banners
- etc.

But if you struggle with creating a set of useful filters, 
simply accept that filtering will not be perfect and ignore: we are NOT building an ad blocker with complex heuristics, cleaning up the noise is a SECONDAY GOAL and OPTIONAL.

# General rules for selectors

These rules apply to all of \`preset_match_detectors\`, \`main_content_detectors\`, and \`main_content_filters\`:

- YOU CAN use descendant selectors, like \`div div div\`, or child selectors, like \`div > div\`, or sibling selectors, like \`div + div\`.
- YOU MUST NOT use nth-child, nth-of-type, etc. selectors and such, as they are likely to change. Moreover, you must not rely on them to be stable, as we do a preprocessing step on the HTML before passing it to you, which removes some elements using heristics.
- YOU MUST NOT use :contains() pseudo-selectors, as they are likely to change.
- AVOID CRYPTIC SELECTORS.Sometimes you will see temporary (dynamically generated), cryptic class names or ids with hexademical or alphanumeric strings, looking like \`\.SDhuSDJBK87SD\` or \`\.elem-a186cef\`, etc.
IT IS ABSOLUTELY CRITICAL THAT YOU MUST NOT INCLUDE these in the selectors, as they are dynamically generated and will change. Instead, use a more generic selector or a selector for PARENT node.
Imperfection is tolerated more than "dynamic" identifiers.

BAD: \`\.element-837af3\`
GOOD: \`body > div > div\`

# Goal

Your goal is to help transform this HTML page into a readable chunk of content, think "reader mode", by iteratively refining a preset object based on your knowledge of the page layout and feedback from the tools you have.

# Task

Your task will be to produce multiple CSS selectors that can be used to extract readable contents.
After that, the preset will be automatically applied and the results will be shown to you as markdown, so that you can reflect on it and adjust the output.

# Output

DO NOT produce any output other than tool calls.

# Examples

## First example: successful preset guess

Input

\`\`\`html
<div class="main">
  <div id="s">
  <a href="/main">Main</a>
  <a href="/about">About</a>
  </div>
  <div id="p">
  CR-SQLite is a run-time loadable extension for SQLite and libSQL... (truncated)
  <span class="sponsored">NordVPN is a fast, secure, and risk-free VPN for online privacy.<span>
  </div>
  <div id="f">
    cr-sqlite (c) 2025
  </div>
</div>
\`\`\`


Suppose you call \`apply_preset\` with the following preset:

\`\`\`
{
  preset_match_detectors: [".main", "#s", "f"],
  main_content_detectors: ["#p"]
  main_content_filters: [".sponsored"]
}
\`\`\`

As a result you will get something like this:

\`\`\`markdown
CR-SQLite is a run-time loadable extension for SQLite and libSQL... (truncated)
\`\`\`

This corresponds to the actual content of the webpage, so you must call \`accept_output\` and stop.

## Second example: failed preset guess, continue

Sometimes you will not be able to get it quite right from the first try, for example you may have missed the need to remove the ad:

\`\`\`
{
  preset_match_detectors: [".main", "#s", "f"],
  main_content_detectors: ["#p"]
  main_content_filters: []
}
\`\`\`

As a result you will get something like this:

\`\`\`markdown
CR-SQLite is a run-time loadable extension for SQLite and libSQL... (truncated)
NordVPN is a fast, secure, and risk-free VPN for online privacy.
\`\`\`

This is bad, you must try another attempt:

\`\`\`
{
  preset_match_detectors: [".main", "#s", "f"],
  main_content_detectors: ["#p"]
  main_content_filters: [".sponsored"]
}
\`\`\`

(The rest will be the same as in the first example.)
`;

export async function suggestPreset({ html, url, maxSteps = 5 }: { html: string; url: string; maxSteps?: number }): Promise<SuggestPresetResult> {
  const promptText = systemPrompt;
  // Pre-clean the input HTML to reduce token usage and noise for the LLM/tools
  const cleaned$ = cleanupToCheerio({ html: asHtml(html), url });
  const cleanedHtmlStr = cleaned$.root().html() ?? '';
  console.log(`[suggestPreset] html.length: ${html.length}, cleanedHtmlStr.length: ${cleanedHtmlStr.length}`);
  console.log(`[suggestPreset] cleanedHtmlStr: ${await formatHtml(cleanedHtmlStr)}`);
  let lastPreset: Preset | null = null;
  let lastMarkdown: string | null = null;
  let accepted = false;
  let stepNo = 0;

  const tools = {
    apply_preset: {
      description: 'Apply the provided Preset to the source HTML and return either errors json or raw html.',
      inputSchema: PresetSchema as unknown as z.ZodTypeAny,
      execute: async (preset: Preset) => {
        const currentStep = ++stepNo;
        lastPreset = preset;
        const result: ApplyResult = await applyPresetToHtml({ html: asHtml(cleanedHtmlStr), preset });
        return match(result)
          .with({ type: 'preset_match_detectors_failed' }, (r) => {
            console.log(`[suggestPreset] step ${currentStep} failed: preset_match_detectors_failed`, r);
            return { ok: false, reason: r };
          })
          .with({ type: 'main_content_selectors_failed' }, (r) => {
            console.log(`[suggestPreset] step ${currentStep} failed: main_content_selectors_failed`, r);
            return { ok: false, reason: r };
          })
          .otherwise(async (cleanHtml) => {
            lastMarkdown = await htmlToMarkdown(cleanHtml as unknown as string);
            console.log(`[suggestPreset] step ${currentStep} markdown:\n${lastMarkdown}`);
            return cleanHtml;
          });
      },
    },
    accept_output: {
      description: 'Call this when satisfied with the result. Takes no arguments.',
      inputSchema: z.object({}).strict(),
      execute: async () => {
        if (!lastPreset || !lastMarkdown) return { type: 'error', message: 'No successful markdown yet.' };
        accepted = true;
        console.log('[suggestPreset] accept_output called. Converged.');
        return { type: 'accepted' };
      },
    },
  } as const;

  const prompt = [
    promptText.trim(),
    '',
    'Tools:',
    '- apply_preset: Provide a Preset JSON to apply to the HTML. You will receive either a failure object with failed selectors or raw HTML.',
    '- accept_output: When you are satisfied, call with no arguments to finish.',
    '',
    '# HTML',
    cleanedHtmlStr.length > 200_000 ? cleanedHtmlStr.slice(0, 200_000) : cleanedHtmlStr,
  ].join('\n');

  await generateText({
    model: openrouter(config.openRouter.model),
    prompt,
    tools,
    toolChoice: 'auto',
    stopWhen: stepCountIs(maxSteps),
  });

  if (!lastPreset) throw new Error('Feedback loop did not produce an accepted result.');

  if (!lastMarkdown) {
    const applied = await applyPresetToHtml({ html: asHtml(cleanedHtmlStr), preset: lastPreset });
    if (typeof applied !== 'string') lastMarkdown = '';
    else lastMarkdown = await htmlToMarkdown(applied);
  }

  return { preset: lastPreset, markdown: lastMarkdown ?? '', accepted };
}


