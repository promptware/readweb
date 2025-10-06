import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupToCheerio, MAX_TEXT_NODE_LENGTH } from '../src/dom/cleanup';
import { MAX_ATTR_LENGTH } from '../src/dom/cleanup';
import { asHtml } from '../src/types/newtype';
const url = 'https://example.com/some/page';

test('cleanupToCheerio: scopes to body when present', () => {
  const html = '<html><head><title>T</title></head><body><div id="x">ok</div></body></html>';
  const $ = cleanupToCheerio({ html: asHtml(html), url });
  const out = $.root().html() ?? '';
  assert.ok(out.includes('<div id="x">ok</div>'));
  assert.ok(!out.includes('<title>'));
});

test('cleanupToCheerio: removes non-visual elements', () => {
  const html = '<div><script>1</script><style>.a{}</style><link rel="preload" href="#"><iframe></iframe><embed/><object></object><meta charset="utf-8"><p>k</p></div>';
  const $ = cleanupToCheerio({ html: asHtml(html), url });
  const out = $.root().html() ?? '';
  assert.ok(out.includes('<p>k</p>'));
  assert.ok(!out.includes('<script'));
  assert.ok(!out.includes('<style'));
  assert.ok(!out.includes('<link'));
  assert.ok(!out.includes('<iframe'));
  assert.ok(!out.includes('<embed'));
  assert.ok(!out.includes('<object'));
  assert.ok(!out.includes('<meta'));
});

test('cleanupToCheerio: truncates long text nodes', () => {
  const long = 'x'.repeat(MAX_TEXT_NODE_LENGTH + 10);
  const html = `<div>${long}</div>`;
  const $ = cleanupToCheerio({ html: asHtml(html), url });
  const out = $.root().html() ?? '';
  assert.ok(out.includes(' (truncated...)'));
});

test('cleanupToCheerio: strips non-allowed attributes and keeps data-*', () => {
  const html = '<img id="i" class="c" src="/a.png" width="100" height="100" data-x="y" onclick="js()" alt="z" />';
  const $ = cleanupToCheerio({ html: asHtml(html), url });
  const out = $.root().html() ?? '';
  assert.ok(out.includes('id="i"'));
  assert.ok(out.includes('class="c"'));
  assert.ok(out.includes('src="/a.png"'));
  assert.ok(out.includes('data-x="y"'));
  assert.ok(out.includes('alt="z"'));
  assert.ok(!out.includes('width="100"'));
  assert.ok(!out.includes('height="100"'));
  assert.ok(!out.includes('onclick='));
});


test('cleanupToCheerio: rewrites same-host absolute URLs to relative', () => {
  const html = [
    '<div>',
    '<a id="a1" href="https://example.com/x?y=1#z">A</a>',
    '<img id="im1" src="//example.com/img.png" alt="i"/>',
    '<a id="a2" href="https://other.com/b">B</a>',
    '<a id="a3" href="/already">C</a>',
    '</div>',
  ].join('');
  const $ = cleanupToCheerio({ html: asHtml(html), url });
  const out = $.root().html() ?? '';
  assert.ok(out.includes('<a id="a1" href="/x?y=1#z">A</a>'));
  assert.ok(out.includes('<img id="im1" src="/img.png" alt="i">'));
  assert.ok(out.includes('<a id="a2" href="https://other.com/b">B</a>'));
  assert.ok(out.includes('<a id="a3" href="/already">C</a>'));
});

test('cleanupToCheerio: truncates long attributes except id and class', () => {
  const long = 'x'.repeat(MAX_ATTR_LENGTH + 20);
  const html = [
    `<div id="ok" class="keep" title="${long}" data-x="${long}">c</div>`,
  ].join('');
  const $ = cleanupToCheerio({ html: asHtml(html), url });
  const out = $.root().html() ?? '';
  // id and class are preserved
  assert.ok(out.includes('id="ok"'));
  assert.ok(out.includes('class="keep"'));
  // title and data-x truncated to exact expected value
  const suffix = ' (truncated...)';
  const keepLen = Math.max(0, MAX_ATTR_LENGTH - suffix.length);
  const expected = 'x'.repeat(keepLen) + suffix;
  const el = $('div#ok');
  assert.equal(el.attr('title'), expected);
  assert.equal(el.attr('data-x'), expected);
  assert.ok(el.attr('id') === 'ok');
  assert.ok(el.attr('class') === 'keep');
});

test('cleanupToCheerio: removes iframe elements', () => {
  const html = '<div><p>keep</p><iframe src="https://example.com/embed"></iframe></div>';
  const $ = cleanupToCheerio({ html: asHtml(html), url });
  const out = $.root().html() ?? '';
  assert.ok(out.includes('<p>keep</p>'));
  assert.ok(!out.includes('<iframe'));
});

test('cleanupToCheerio: removes HTML comments', () => {
  const html = '<div><!-- comment --><p>keep</p><!-- another --></div>';
  const $ = cleanupToCheerio({ html: asHtml(html), url });
  const out = $.root().html() ?? '';
  assert.ok(out.includes('<p>keep</p>'));
  assert.ok(!out.includes('<!--'));
});

test('cleanupToCheerio: decodes HTML entities before parsing', () => {
  const html = '&#x3C;div id="x"&#x3E;hi&amp;lo&#x3C;/div&#x3E;';
  const $ = cleanupToCheerio({ html: asHtml(html), url });
  const el = $('#x');
  assert.equal(el.length, 1);
  assert.equal(el.text(), 'hi&lo');
});


test('cleanupToCheerio: prunes empty elements and cascades', () => {
  const html = '<div id="wrap"><div><span></span></div><p>keep</p></div>';
  const $ = cleanupToCheerio({ html: asHtml(html), url });
  // inner div with no attributes and empty child should be removed
  assert.equal($('div#wrap > div').length, 0);
  assert.equal($('div#wrap > p').length, 1);
});

test('cleanupToCheerio: rewrites same-host absolute form action to relative', () => {
  const html = '<form action="https://example.com/submit?a=1#z"><input></form>';
  const $ = cleanupToCheerio({ html: asHtml(html), url });
  const action = $('form').attr('action');
  assert.equal(action, '/submit?a=1#z');
});

test('cleanupToCheerio: invalid page URL skips rewriting without crashing', () => {
  const badUrl = 'not a valid url';
  const html = '<a href="https://example.com/x">x</a>';
  const $ = cleanupToCheerio({ html: asHtml(html), url: badUrl });
  const href = $('a').attr('href');
  assert.equal(href, 'https://example.com/x');
});

test('cleanupToCheerio: removes other non-visual elements (svg/canvas/video/audio/picture/source/track)', () => {
  const html = [
    '<div>',
    '<svg></svg>',
    '<canvas></canvas>',
    '<video src="v.mp4"></video>',
    '<audio src="a.mp3"></audio>',
    '<picture><source srcset="i.jpg"></picture>',
    '<track>',
    '<p>keep</p>',
    '</div>',
  ].join('');
  const $ = cleanupToCheerio({ html: asHtml(html), url });
  const out = $.root().html() ?? '';
  assert.ok(out.includes('<p>keep</p>'));
  assert.ok(!out.includes('<svg'));
  assert.ok(!out.includes('<canvas'));
  assert.ok(!out.includes('<video'));
  assert.ok(!out.includes('<audio'));
  assert.ok(!out.includes('<picture'));
  assert.ok(!out.includes('<source'));
  assert.ok(!out.includes('<track'));
});

test('cleanupToCheerio: text exactly at MAX_TEXT_NODE_LENGTH is not truncated', () => {
  const text = 'x'.repeat(MAX_TEXT_NODE_LENGTH);
  const html = `<div>${text}</div>`;
  const $ = cleanupToCheerio({ html: asHtml(html), url });
  const out = $.root().html() ?? '';
  assert.ok(out.includes(text));
  assert.ok(!out.includes(' (truncated...)'));
});

test('cleanupToCheerio: attribute exactly at MAX_ATTR_LENGTH is not truncated', () => {
  const val = 'x'.repeat(MAX_ATTR_LENGTH);
  const html = `<div title="${val}" data-x="${val}">k</div>`;
  const $ = cleanupToCheerio({ html: asHtml(html), url });
  const el = $('div');
  assert.equal(el.attr('title'), val);
  assert.equal(el.attr('data-x'), val);
});


