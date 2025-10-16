import Firecrawl, { FirecrawlClient } from 'firecrawl';
import { ENV } from '../env';

// Use unified client (v2 by default). Expose both in case we ever need v1.
export const firecrawl = new Firecrawl({ apiKey: ENV.FIRECRAWL_API_KEY });
export const firecrawlV2: FirecrawlClient = firecrawl;

export async function fetchMarkdownFirecrawl({ url }: { url: string }): Promise<string> {
  try {
    const doc = await firecrawlV2.scrape(url, { formats: ['markdown'] });
    if (!doc.markdown) {
      throw new Error('Firecrawl returned no markdown');
    }
    return doc.markdown;
  } catch (e) {
    console.error('[fetchMarkdownFirecrawl] error', e);
    throw e;
  }
}

export async function fetchHTMLFirecrawl({ url }: { url: string }): Promise<string> {
  try {
    const doc = await firecrawlV2.scrape(url, { formats: ['html'] });
    if (!doc.html) {
      throw new Error('Firecrawl returned no html');
    }
    return doc.html;
  } catch (e) {
    console.error('[fetchHTMLFirecrawl] error', e);
    throw e;
  }
}

export async function fetchHtmlAndMarkdownFirecrawl({ url }: { url: string }): Promise<{ html: string; markdown: string; }> {
  // Single request for both formats; no fallback.
  const doc = await firecrawlV2.scrape(url, { formats: ['html', 'markdown'] });
  const { html, markdown } = doc;
  if (!html || !markdown) {
    throw new Error(`Firecrawl missing format(s): ${!html ? 'html ' : ''}${!markdown ? 'markdown' : ''}`.trim());
  }
  return { html, markdown };
}


