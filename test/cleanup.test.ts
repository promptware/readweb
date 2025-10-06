import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupToCheerio, MAX_TEXT_NODE_LENGTH } from '../src/dom/cleanup';
import { asHtml } from '../src/types/newtype';

test('cleanupToCheerio: scopes to body when present', () => {
  const html = '<html><head><title>T</title></head><body><div id="x">ok</div></body></html>';
  const $ = cleanupToCheerio({ html: asHtml(html) });
  const out = $.root().html() ?? '';
  assert.ok(out.includes('<div id="x">ok</div>'));
  assert.ok(!out.includes('<title>'));
});

test('cleanupToCheerio: removes non-visual elements', () => {
  const html = '<div><script>1</script><style>.a{}</style><link rel="preload" href="#"><iframe></iframe><embed/><object></object><meta charset="utf-8"><p>k</p></div>';
  const $ = cleanupToCheerio({ html: asHtml(html) });
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
  const $ = cleanupToCheerio({ html: asHtml(html) });
  const out = $.root().html() ?? '';
  assert.ok(out.includes(' (truncated...)'));
});

test('cleanupToCheerio: strips non-allowed attributes and keeps data-*', () => {
  const html = '<img id="i" class="c" src="/a.png" width="100" height="100" data-x="y" onclick="js()" alt="z" />';
  const $ = cleanupToCheerio({ html: asHtml(html) });
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


