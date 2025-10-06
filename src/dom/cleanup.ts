import * as cheerio from 'cheerio';
import { decodeHTML } from 'entities';
import { Html } from '../types/newtype';
import { isGibberishIdentifier } from './identifiers';

export const MAX_TEXT_NODE_LENGTH = 120;
export const MAX_ATTR_LENGTH = 100;

export function cleanupToCheerio({ html, url }: { html: Html; url: string }): cheerio.CheerioAPI {
  // Decode entities safely before parsing to avoid treating encoded tags as text
  const decoded = decodeHTML(html as unknown as string);
  const $ = cheerio.load(decoded);

  // 1) Consider only <body> when present; otherwise use full document/fragment
  const body = $('body');
  const scopeHtml = body.length > 0 ? body.html() ?? '' : $.root().html() ?? '';
  const $c = cheerio.load(scopeHtml);

  // 2) Remove non-renderable-to-markdown elements
  const nonRenderableSelectors = [
    'script',
    'style',
    'link[rel]',
    'iframe',
    'embed',
    'object',
    'meta',
    'svg',
    'path',
    'canvas',
    'video',
    'audio',
    'picture',
    'source',
    'track',
  ];
  $c(nonRenderableSelectors.join(',')).remove();

  // 3) Remove HTML comments
  const root = $c.root().get(0) as unknown as { children?: any[] };
  removeCommentNodes(root);

  // 4) Truncate long text nodes
  truncateTextNodes(root, $c);

  // 5) Remove all non-whitelisted attributes
  const allowed = new Set<string>([
    'id',
    'class',
    'href',
    'lang',
    'title',
    'alt',
    'value',
    'name',
    'placeholder',
    'checked',
    'selected',
    'disabled',
    'readonly',
    'action',
    'method',
    'src',
  ]);

  $c('*').each((_, el) => {
    const node: any = el as any;
    const attribs: Record<string, string> = node.attribs ?? {};
    for (const attrName of Object.keys(attribs)) {
      if (allowed.has(attrName)) continue;
      if (attrName.startsWith('data-')) continue;
      if (node.attribs) delete node.attribs[attrName];
    }
  });

  // 6) Filter gibberish ids and classes
  filterGibberishIdsAndClasses($c);

  // 7) Remove elements that have no children and no attributes; repeat until stable
  pruneEmptyElements($c);

  // 8) Rewrite same-host absolute URLs to relative
  rewriteUrlsToRelativeSameHost($c, url);

  // 9) Truncate long attribute values except for id and class
  truncateLongAttributes($c);

  return $c;
}

function truncateTextNodes(node: { children?: any[] } | undefined, $c: cheerio.CheerioAPI): void {
  if (!node || !Array.isArray(node.children)) return;
  for (const child of node.children) {
    if (child && child.type === 'text' && typeof child.data === 'string') {
      if (child.data.length > MAX_TEXT_NODE_LENGTH) {
        child.data = child.data.slice(0, MAX_TEXT_NODE_LENGTH) + ' (truncated...)';
      }
    }
    if (child && Array.isArray(child.children)) truncateTextNodes(child, $c);
  }
}

function removeCommentNodes(node: { children?: any[] } | undefined): void {
  if (!node || !Array.isArray(node.children)) return;
  node.children = node.children.filter((child: any) => (child?.type as unknown) !== 'comment');
  for (const child of node.children) {
    if (child && Array.isArray(child.children)) removeCommentNodes(child);
  }
}

function pruneEmptyElements($c: cheerio.CheerioAPI): void {
  // Repeat because removing leaf nodes may expose new empty parents
  while (true) {
    const empties = $c('*').filter((_, el) => {
      const node: any = el as any;
      const attribsCount = node.attribs ? Object.keys(node.attribs).length : 0;
      const childrenCount = Array.isArray(node.children) ? node.children.length : 0;
      return attribsCount === 0 && childrenCount === 0;
    });
    if (empties.length === 0) break;
    empties.remove();
  }
}

function filterGibberishIdsAndClasses($c: cheerio.CheerioAPI): void {
  $c('*').each((_, el) => {
    const node: any = el as any;
    const attribs: Record<string, string> = node.attribs ?? {};

    // ID: drop if gibberish
    const idValue = attribs.id;
    if (typeof idValue === 'string' && isGibberishIdentifier(idValue)) {
      if (node.attribs) delete node.attribs.id;
    }

    // class: split by whitespace, remove gibberish tokens, update/remove accordingly
    const classValue = attribs.class;
    if (typeof classValue === 'string') {
      const tokens = classValue.split(/\s+/).filter(Boolean);
      const filtered = tokens.filter((t) => !isGibberishIdentifier(t));
      if (filtered.length === 0) {
        if (node.attribs) delete node.attribs.class;
      } else if (filtered.length !== tokens.length) {
        node.attribs.class = filtered.join(' ');
      }
    }

    // data-* attributes: treat value as a single identifier; drop if gibberish
    for (const attrName of Object.keys(attribs)) {
      if (!attrName.startsWith('data-')) continue;
      const value = attribs[attrName];
      if (typeof value !== 'string') continue;
      if (isGibberishIdentifier(value)) {
        if (node.attribs) delete node.attribs[attrName];
      }
    }
  });
}

function rewriteUrlsToRelativeSameHost($c: cheerio.CheerioAPI, baseUrl: string): void {
  let base: URL | null = null;
  try {
    base = new URL(baseUrl);
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.warn(`[cleanup] Invalid base URL provided: ${baseUrl} (${msg})`);
    return;
  }

  const sameHostToRelative = (value: string): string => {
    // Only rewrite originally absolute URLs (http(s) or protocol-relative)
    const isAbsolute = /^(https?:)?\/\//i.test(value);
    if (!isAbsolute) return value;
    let u: URL | null = null;
    try {
      u = new URL(value, base as URL);
    } catch {
      return value;
    }
    if (u.hostname === (base as URL).hostname) {
      return `${u.pathname}${u.search}${u.hash}` || '/';
    }
    return value;
  };

  $c('[href],[src],[action]').each((_, el) => {
    const $el = $c(el);
    const attrs = ['href', 'src', 'action'] as const;
    for (const attr of attrs) {
      const v = $el.attr(attr);
      if (typeof v !== 'string') continue;
      const nv = sameHostToRelative(v);
      if (nv !== v) $el.attr(attr, nv);
    }
  });
}

function truncateLongAttributes($c: cheerio.CheerioAPI): void {
  const suffix = ' (truncated...)';
  const keepLen = Math.max(0, MAX_ATTR_LENGTH - suffix.length);
  $c('*').each((_, el) => {
    const node: any = el as any;
    const attribs: Record<string, string> = node.attribs ?? {};
    for (const attrName of Object.keys(attribs)) {
      const value = attribs[attrName];
      if (typeof value !== 'string') continue;
      if (attrName === 'id' || attrName === 'class') continue;
      if (value.length > MAX_ATTR_LENGTH) {
        node.attribs[attrName] = value.slice(0, keepLen) + suffix;
      }
    }
  });
}


