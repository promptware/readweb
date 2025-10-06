import * as cheerio from 'cheerio';
import { Html } from '../types/newtype';

export const MAX_TEXT_NODE_LENGTH = 120;

export function cleanupToCheerio({ html }: { html: Html }): cheerio.CheerioAPI {
  const $ = cheerio.load(html as unknown as string);

  // 1) Consider only <body> when present; otherwise use full document/fragment
  const body = $('body');
  const scopeHtml = body.length > 0 ? body.html() ?? '' : $.root().html() ?? '';
  const $c = cheerio.load(scopeHtml);

  // 2) Remove non-visual elements
  $c('script').remove();
  $c('style').remove();
  $c('link[rel]').remove();
  $c('iframe').remove();
  $c('embed').remove();
  $c('object').remove();
  $c('meta').remove();
  $c('svg').remove();
  $c('path').remove();
  $c('canvas').remove();
  $c('video').remove();
  $c('audio').remove();
  $c('picture').remove();
  $c('source').remove();
  $c('track').remove();

  // 3) Truncate long text nodes
  const root = $c.root().get(0) as unknown as { children?: any[] };
  truncateTextNodes(root, $c);

  // 4) Remove all non-whitelisted attributes
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

  // 5) Remove elements that have no children and no attributes; repeat until stable
  pruneEmptyElements($c);

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


