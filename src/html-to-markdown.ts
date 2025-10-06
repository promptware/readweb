import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { remove } from 'unist-util-remove';

export async function htmlToMarkdown(html: string): Promise<string> {
  const file = await unified()
    .use(rehypeParse, { fragment: true })
    // Remove unwanted elements before sanitization
    .use(() => (tree) => {
      remove(tree, (node: any) => {
        return (
          node.type === 'element' &&
          ['head', 'style', 'script', 'noscript', 'meta', 'title', 'link'].includes(node.tagName)
        );
      });
    })
    .use(rehypeSanitize, {
      // Custom schema that excludes unwanted elements
      tagNames: [
        // Content sectioning
        'article',
        'aside',
        'footer',
        'header',
        'main',
        'nav',
        'section',
        // Text content
        'blockquote',
        'dd',
        'div',
        'dl',
        'dt',
        'figcaption',
        'figure',
        'hr',
        'li',
        'ol',
        'p',
        'pre',
        'ul',
        // Inline text semantics
        'a',
        'abbr',
        'b',
        'bdi',
        'bdo',
        'br',
        'cite',
        'code',
        'data',
        'dfn',
        'em',
        'i',
        'kbd',
        'mark',
        'q',
        's',
        'samp',
        'small',
        'span',
        'strong',
        'sub',
        'sup',
        'time',
        'u',
        'var',
        // Image and multimedia
        'img',
        'audio',
        'video',
        'source',
        'track',
        // Table content
        'table',
        'caption',
        'col',
        'colgroup',
        'tbody',
        'td',
        'tfoot',
        'th',
        'thead',
        'tr',
        // Forms (basic)
        'button',
        'datalist',
        'fieldset',
        'form',
        'input',
        'label',
        'legend',
        'meter',
        'optgroup',
        'option',
        'output',
        'progress',
        'select',
        'textarea',
        // Interactive elements
        'details',
        'dialog',
        'summary',
        // Headings
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
      ],
      // Explicitly exclude head, style, script, etc.
      strip: ['head', 'style', 'script', 'noscript', 'meta', 'title', 'link'],
    })
    .use(rehypeRemark)
    .use(remarkGfm)
    .use(remarkStringify, {
      bullet: '-',
      fences: true,
      listItemIndent: 'one',
      rule: '-',
      strong: '*',
      emphasis: '_',
      tightDefinitions: true,
    })
    .process(html);
  return String(file);
}