import test from 'node:test';
import assert from 'node:assert/strict';
import { isGibberishIdentifier, getGibberishScore } from '../src/dom/identifiers';

type Fixture = { input: string; isGibberish: boolean };

const fixtures: Fixture[] = [
  // From examples
  { input: 'z2', isGibberish: false },
  { input: 'TccjmKV6RraCaCw5L9gd', isGibberish: true },
  { input: 'VYRn0PqcTApLnWYi0GKA', isGibberish: true },
  { input: 'ffON2NH02oMAcqyoh2UU', isGibberish: true },
  { input: 'iqWauQNeRzJ1Ot90nG8b', isGibberish: true },
  { input: 'BEgMhHlL4pzYLkyLJv4B', isGibberish: true },
  { input: 'SzPW9boEgn116L6lq3RA', isGibberish: true },
  { input: 'Fe7JdhVTO1JKVRlHT8gi', isGibberish: true },
  { input: 't5_JGL0gn0OZYrLgkYOJ', isGibberish: true },
  { input: 'DZHFpq3rUWEmzHu77zlF', isGibberish: true },
  { input: 'YZqM_sNA5T5wRIPK_wCK', isGibberish: true },
  { input: '5d32008a_4274_4039_9573_105622184004', isGibberish: true },
  { input: 'elementor-repeater-item-5b95dec', isGibberish: true },
  { input: 'elementor-element-8ae8848', isGibberish: true },
  // uuid
  { input: '53b1224c-588a-439a-8495-772814379478', isGibberish: true },
  // long number
  { input: 'article-123', isGibberish: true },

  // Non-gibberish heuristics sanity
  { input: 'container', isGibberish: false },
  { input: 'btn-primary', isGibberish: false },
  { input: 'header', isGibberish: false },
  { input: 'nav-bar-0', isGibberish: false },
  { input: 'navBar', isGibberish: false },
  { input: 'article-menu-item', isGibberish: false },
];

for (const { input, isGibberish } of fixtures) {
  test(`isGibberishIdentifier(${JSON.stringify(input)})`, () => {
    const score = getGibberishScore(input);
    const actual = { input, isGibberish: isGibberishIdentifier(input) };
    const expected = { input, isGibberish };
    assert.deepEqual(actual, expected, `score=${score.toFixed(4)}`);
  });
}


