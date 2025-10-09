# Content Extraction Service Specification

## Purpose
Extract the main content from any web page and return it as clean Markdown, aggressively removing non-content elements to save LLM tokens. Supports dynamic content (JS-rendered pages) and LLM-assisted selector generation.

---

## 1. Input/Output

**HTTP API:**

- **Endpoint:** `/extract`
- **Method:** `POST`
- **Input JSON:**
```ts
{
  url: string,
  html: string
}
```
- **Output JSON:**
```ts
{
  main: string // markdown
}
```

---

## 2. Stages / Workflow

1. **Initial Cleanup**
   - Remove all `<style>` and `<script>` elements.
   - Keep only elements with visual representation.
   
2. **Preset Lookup**
   - Query saved presets for the given URL, ordered by successful hit count.
   
3. **Preset Application**
   - If presets exist:
     - Iterate over presets until one successfully applies.
     - Generate output using that preset.
   - If no presets exist:
     - Enter `createPresets` procedure using LLM to generate selectors.

4. **Content Extraction**
   - Apply `main_content_selectors` to extract content.
   - Apply `main_content_filters` to exclude embedded unwanted elements.
   - Concatenate results and convert to Markdown.

---

## 3. Preset Structure

```ts
interface Selector {
  type: 'css' | 'xpath',
  selector: string
}

interface Preset {
  preset_match_detectors: Selector[],  // must match for this preset to apply
  main_content_selectors: Selector[],  // selectors for main content
  main_content_filters: Selector[]     // selectors to exclude from main content
}
```

**Notes:**
- `preset_match_detectors` ensures the page layout matches what has been successfully processed before.
- `main_content_selectors` define the main content areas.
- `main_content_filters` remove unwanted embedded content before conversion.

---

## 4. LLM-Assisted Preset Creation

- Generate candidate `main_content_selectors` and `main_content_filters`.
- Optionally suggest `preset_match_detectors`.
- Output must conform to the `Preset` structure.
- Iteratively refine by applying filters and asking LLM to adjust if noise remains.

---

## 5. Selector Types

- CSS selectors: `{ type: 'css', selector: 'div.article-content' }`
- XPath selectors: `{ type: 'xpath', selector: '//div[@id="main"]' }`

---

## 6. Scope & Limitations

- Currently supports single-page extraction.
- Users provide the URL and raw HTML.
- Aggressive filtering is required to minimize token usage.
- Future improvements can include multi-page or batch extraction.

---

# Stack

## Backend
- **Runtime**: Node.js + TypeScript
- **HTTP API**: Express

## HTML Processing
- `cheerio`: Fast HTML parsing and CSS selector support.
- `xpath` (npm): If XPath selector support is needed.
- `sanitize-html`: Optionally for aggressive clean-up of noise elements.

## Markdown Conversion
- `turndown`: Reliable HTML → Markdown conversion.

## LLM Integration
- gemini flash via openrouter

## Preset Storage
- PostgreSQL

## Testing & Dev Utilities
- `zod` for schema validation.
- `pnpm` for fast mono-repo management.

