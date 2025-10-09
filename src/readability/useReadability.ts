import { Readability, isProbablyReaderable } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { htmlToMarkdown } from '../html-to-markdown';

export interface UseReadabilityParams {
  html: string;
  url: string;
}

export interface SuccessMarkdown {
  type: 'ok';
  markdown: string;
  meta: {
    title?: string;
    length: number;
    excerpt?: string | null;
    byline?: string | null;
    siteName?: string | null;
    lang?: string | null;
    publishedTime?: string | null;
    dir?: string | null;
  };
}

export interface FailureNotApplicable {
  type: 'not_applicable';
}

export interface FailedToApply {
  type: 'failed_to_apply';
}

export type UseReadabilityResult = SuccessMarkdown | FailureNotApplicable | FailedToApply;

function createDocument({ html, url }: { html: string; url: string }): Document {
  const dom = new JSDOM(html, {
    url,
    // Security: never execute scripts or fetch resources
    pretendToBeVisual: false,
    runScripts: 'outside-only',
    resources: 'usable',
  });
  return dom.window.document;
}

export async function useReadability({ html, url }: UseReadabilityParams): Promise<UseReadabilityResult> {
  if (!html || !html.trim()) {
    return { type: 'not_applicable' };
  }

  let document: Document;
  try {
    document = createDocument({ html, url });
  } catch (e) {
    console.error('[useReadability] Failed to create JSDOM document', e);
    return { type: 'failed_to_apply' };
  }

  try {
    const readerable = isProbablyReaderable(document);
    if (!readerable) {
      return { type: 'not_applicable' };
    }

    const reader = new Readability(document, {
      debug: false,
      keepClasses: false,
    });
    const article = reader.parse();

    if (!article || !article.content) {
      return { type: 'failed_to_apply' };
    }

    const markdown = await htmlToMarkdown(article.content);

    return {
      type: 'ok',
      markdown,
      meta: {
        title: article.title ?? undefined,
        length: article.length ?? 0,
        excerpt: article.excerpt ?? null,
        byline: article.byline ?? null,
        siteName: (article as any).siteName ?? null,
        lang: (article as any).lang ?? null,
        publishedTime: (article as any).publishedTime ?? null,
        dir: (article as any).dir ?? null,
      },
    };
  } catch (e) {
    console.error('[useReadability] Readability failed', e);
    return { type: 'failed_to_apply' };
  }
}


