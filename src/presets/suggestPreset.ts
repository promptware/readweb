import { readFile } from 'fs/promises';
import { z } from 'zod';
import { generateText, stepCountIs } from 'ai';
import { openrouter } from '../clients/ai';
import { ENV } from '../env';
import { Preset, PresetSchema } from '../types/preset';
import { applyPresetToHtml, ApplyResult } from './applyPreset';
import { validatePresetCritical, validatePresetNonCritical, renderCriticalPresetValidationProblems, renderNonCriticalPresetValidationProblems } from './validatePreset';
import { asHtml } from '../types/newtype';
import { match, P } from 'ts-pattern';
import { htmlToMarkdown } from '../html-to-markdown';
import { cleanupToCheerio } from '../dom/cleanup';
import { formatHtml } from '../dom/format';
import chalk from 'chalk';

export interface SuggestPresetResult {
  preset: Preset;
  markdown: string;
  accepted: boolean;
}

const systemPrompt = `
# Overall system overview

To give you overall context of what is happening, you are a part of a larger system, the goal of which is to transform pages into readable "main content" excerpts.

It does so by using Presets tailored for particular websites.

\`\`\`ts
type CSSSelector = string;

interface Preset {
  preset_match_detectors: CSSSelector[];
  main_content_selectors: CSSSelector[];
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

## \`main_content_selectors\`

These are CSS selectors used to capture the main human-readable content. Multiple selectors are allowed.

## \`main_content_filters\`

Filters can be used to "exclude" certain elements FROM the main content, like:
- ads
- banners
- popups
- sponsored content
- distractions
- tables of contents
- cookie consent banners
- modals
- testimonials
- "share on social media" blocks
- "read more" blocks
- "subscribe" blocks
- "sign up", "log in" or "log out" elements
- "contact us" or "feedback" forms
- paywall banners
- etc.

Elements that SHOULD NOT be filtered out are:
- in-content images that illustrate the text
- bullet points and numbered lists that are part of the text

The filter selectors will be applied to the main content fragments only, so only include selectors relevant to the main content, and NOT the contents outside of the main content.

But if you struggle with creating a set of useful filters,
simply accept that filtering will not be perfect and ignore: we are NOT building an ad blocker with complex heuristics, cleaning up the noise is a SECONDAY GOAL and OPTIONAL.

# General rules for selectors

These rules apply to all of \`preset_match_detectors\`, \`main_content_selectors\`, and \`main_content_filters\`:

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

# Workflow

1. You will be given an HTML page.
2. You will need to produce a preset object using apply_preset tool.
3. You will see the result of applying the preset object to the HTML page as a tool response. It will be either a failure description, or raw markdown.
4. In the case of failure, you will need to adjust the preset object taking into account the failure description, and go to step 2.
5. In the case of successful preset application, you must check whether the output you received is complete: does it include all the main content or have you missed something?
6. If you have missed something, you will need to adjust the preset object and go to step 2.
7. If the output is complete, you must call the \`accept_output\` tool.

# Examples

The examples work with the following HTML page as input:

\`\`\`html
<div class="main">
  <div id="s">
  <a href="/main">Main</a>
  <a href="/about">About</a>
  </div>
  <div id="p">
  <p id="cr-sqlite">CR-SQLite is a run-time loadable extension for SQLite and libSQL... (truncated)</p>
  <span class="sponsored">NordVPN is a fast, secure, and risk-free VPN for online privacy.<span>
  <p id="cr-sqlite-features">CR-SQLite comes with a set of features... (truncated)</p>
  </div>
  <div id="f">
    cr-sqlite (c) 2025
  </div>
</div>
\`\`\`

## First example: successful preset guess

Suppose you call \`apply_preset\` with the following preset:

\`\`\`
{
  preset_match_detectors: [".main", "#s", "f"],
  main_content_selectors: ["#p"]
  main_content_filters: [".sponsored"]
}
\`\`\`

As a result you will get something like this:

\`\`\`markdown
CR-SQLite is a run-time loadable extension for SQLite and libSQL... (truncated)
CR-SQLite comes with a set of features... (truncated)
\`\`\`

This corresponds to the actual content of the webpage, so you must call \`accept_output\` and stop.

## Second example: failed preset guess

Sometimes you will not be able to get it quite right from the first try, for example you may have missed the need to remove the ad:

\`\`\`
{
  preset_match_detectors: [".main", "#s", "f"],
  main_content_selectors: ["#p"]
  main_content_filters: []
}
\`\`\`

As a result you will get something like this:

\`\`\`markdown
CR-SQLite is a run-time loadable extension for SQLite and libSQL... (truncated)
NordVPN is a fast, secure, and risk-free VPN for online privacy.
CR-SQLite comes with a set of features... (truncated)
\`\`\`

This is bad, you must try another attempt:

\`\`\`
{
  preset_match_detectors: [".main", "#s", "f"],
  main_content_selectors: ["#p"]
  main_content_filters: [".sponsored"]
}
\`\`\`

(The rest will be the same as in the first example.)

## Third example: missing webpage content

Sometimes you may observe that you have forgotten to include some content in the preset.

For example, you may have missed the need to remove the ad:

\`\`\`
{
  preset_match_detectors: [".main", "#s", "f"],
  main_content_selectors: ["#cr-sqlite"]
  main_content_filters: [".sponsored"]
}
\`\`\`

As a result you will get something like this:

\`\`\`
CR-SQLite is a run-time loadable extension for SQLite and libSQL... (truncated)
\`\`\`

The second sentence is missing, you must reflect on that and try another attempt. The problem is that the selector you provided is too specific.

(The rest will be the same as in the first example.)
`;

function formatIssuesText({ criticalText, nonCriticalText }: { criticalText: string; nonCriticalText: string }): string {
  const combined = [criticalText, nonCriticalText].filter(Boolean).join('\n');
  if (!combined) return '';
  const preamble = 'Please fix the following issues in your next attempt:';
  return [preamble, combined].join('\n');
}

function formatPreviewText(markdown: string): string {
  if (!markdown || !markdown.trim()) return '';
  const preamble = 'Extraction preview (markdown):';
  return ['\n\n' + preamble, markdown].join('\n');
}

export async function suggestPreset({ html, url, maxSteps = 5 }: { html: string; url: string; maxSteps?: number }): Promise<SuggestPresetResult> {
  const promptText = systemPrompt;
  // Pre-clean the input HTML to reduce token usage and noise for the LLM/tools
  const cleaned$ = cleanupToCheerio({ html: asHtml(html), url });
  const cleanedHtmlStr = cleaned$.root().html() ?? '';
  console.log(`[suggestPreset] html.length: ${html.length}, cleanedHtmlStr.length: ${cleanedHtmlStr.length}`);
  {
    const prettyHtml = await formatHtml(cleanedHtmlStr);
    console.log(chalk.white('[suggestPreset] cleaned HTML:'));
    console.log(chalk.hex('#ff69b4')(prettyHtml));
  }
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
        console.log(chalk.white(`[suggestPreset] step ${currentStep} preset:`));
        console.log(chalk.cyanBright(JSON.stringify(preset, null, 2)));
        const $ = cleaned$; // cheerio of cleanedHtmlStr
        const critical = validatePresetCritical({ html: $, preset });
        const hasInvalid = critical.some((p) => p.type === 'invalid_selectors_detected');
        const nonCritical = hasInvalid ? [] : validatePresetNonCritical({ html: $, preset });
        const criticalText = renderCriticalPresetValidationProblems(critical);
        const nonCriticalText = renderNonCriticalPresetValidationProblems(nonCritical);
        const feedback = formatIssuesText({ criticalText, nonCriticalText });
        const issuesExist = Boolean(feedback);
        const preamble = 'Please fix the following issues in your next attempt:';

        const result: ApplyResult = await applyPresetToHtml({ html: asHtml(cleanedHtmlStr), preset });
        const applied = await match(result)
          .with({ type: 'preset_match_detectors_failed' }, (r) => {
            const msg = `Preset match selectors matched nothing: ${r.failed_selectors.join(', ')}`;
            const fb = [feedback, msg].filter(Boolean).join('\n');
            console.log(chalk.bgRed.white(`[suggestPreset] step ${currentStep} failed: preset_match_detectors_failed`), r);
            console.log(chalk.red(`[suggestPreset] step ${currentStep} feedback (critical):`));
            console.log(chalk.red(fb));
            return fb;
          })
          .with({ type: 'main_content_selectors_failed' }, (r) => {
            const msg = `Main content selectors matched nothing: ${r.failed_selectors.join(', ')}`;
            const fb = [feedback, msg].filter(Boolean).join('\n');
            console.log(chalk.bgRed.white(`[suggestPreset] step ${currentStep} failed: main_content_selectors_failed`), r);
            console.log(chalk.red(`[suggestPreset] step ${currentStep} feedback (critical):`));
            console.log(chalk.red(fb));
            return fb;
          })
          .with({ type: 'invalid_selectors_failed' }, (r) => {
            const msg = `Some selectors are invalid and must be corrected: ${r.failed_selectors.join(', ')}`;
            const fb = [feedback, msg].filter(Boolean).join('\n');
            console.log(chalk.bgRed.white(`[suggestPreset] step ${currentStep} failed: invalid_selectors_failed`), r);
            console.log(chalk.red(`[suggestPreset] step ${currentStep} feedback (critical):`));
            console.log(chalk.red(fb));
            return fb;
          })
          .with({ type: 'ok' }, async ({ html: cleanHtml }) => {
            lastMarkdown = await htmlToMarkdown(cleanHtml as unknown as string);
            console.log(chalk.white(`[suggestPreset] step ${currentStep} extraction succeeded`));
            console.log(chalk.white(`[suggestPreset] step ${currentStep} markdown:`));
            console.log(chalk.green(lastMarkdown ?? ''));
            const preview = formatPreviewText(lastMarkdown ?? '');
            if (issuesExist) {
              const fb = [feedback, preview].filter(Boolean).join('\n');
              console.log(chalk.yellow(`[suggestPreset] step ${currentStep} feedback (non-critical):`));
              console.log(chalk.yellow(fb));
              return fb;
            }
            console.log(chalk.gray(`[suggestPreset] step ${currentStep} feedback: no issues detected`));
            return preview;
          })
          .exhaustive();
        return applied;
      },
    },
    accept_output: {
      description: 'Call this when satisfied with the result. Takes no arguments.',
      inputSchema: z.object({}).strict(),
      execute: async () => {
        if (!lastPreset || !lastMarkdown) return { type: 'error', message: 'No successful markdown yet. Try again.' };
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
    '- apply_preset: Provide a Preset JSON to apply to the HTML. The tool returns plain text feedback (with a short preamble telling you to fix these) and, when extraction succeeds, a markdown preview.',
    '- accept_output: When you are satisfied, call with no arguments to finish.',
    '',
    '# HTML',
    cleanedHtmlStr.length > 200_000 ? cleanedHtmlStr.slice(0, 200_000) : cleanedHtmlStr,
  ].join('\n');

  await generateText({
    model: openrouter(ENV.OPENROUTER_MODEL),
    prompt,
    tools,
    toolChoice: 'auto',
    stopWhen: stepCountIs(maxSteps),
  });

  if (!lastPreset) throw new Error('Feedback loop did not produce an accepted result.');

  if (!lastMarkdown) {
    const applied = await applyPresetToHtml({ html: asHtml(cleanedHtmlStr), preset: lastPreset });
    if (applied.type === 'ok') {
      lastMarkdown = await htmlToMarkdown(applied.html as unknown as string);
    } else {
      lastMarkdown = '';
    }
  }

  return { preset: lastPreset, markdown: lastMarkdown ?? '', accepted };
}
