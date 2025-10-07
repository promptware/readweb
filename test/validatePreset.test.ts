import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';

import { validatePresetCritical, validatePresetNonCritical, type CriticalPresetValidationProblem, type NonCriticalPresetValidationProblem } from '../src/presets/validatePreset';
import type { Preset } from '../src/types/preset';

function makeDoc(html: string) {
  return cheerio.load(html);
}

test('critical: preset_match_detectors_did_not_hit_any_node only', () => {
  const $ = makeDoc('<div id="content">Hello</div>');
  const preset: Preset = {
    preset_match_detectors: ['.nav'],
    main_content_selectors: ['#content'],
    main_content_filters: [],
  };
  const result = validatePresetCritical({ html: $, preset });
  const expected: CriticalPresetValidationProblem[] = [
    { type: 'preset_match_detectors_did_not_hit_any_node', selector: ['.nav'] },
  ];
  assert.deepEqual(result, expected);
});

test('critical: main_content_selectors_failed only', () => {
  const $ = makeDoc('<div class="app"><div class="nav"></div></div>');
  const preset: Preset = {
    preset_match_detectors: ['.nav'],
    main_content_selectors: ['#missing'],
    main_content_filters: [],
  };
  const result = validatePresetCritical({ html: $, preset });
  const expected: CriticalPresetValidationProblem[] = [
    { type: 'main_content_selectors_failed', selector: ['#missing'] },
  ];
  assert.deepEqual(result, expected);
});

test('critical: invalid selectors reported along with other critical problems', () => {
  const $ = makeDoc('<div class="app"><div id="content">X</div></div>');
  const preset: Preset = {
    preset_match_detectors: ['.missing-nav'], // will fail
    main_content_selectors: ['#missing-content'], // will fail
    main_content_filters: ['div:contains('], // invalid
  };
  const result = validatePresetCritical({ html: $, preset });
  const expected: CriticalPresetValidationProblem[] = [
    { type: 'invalid_selectors_detected', selector: ['div:contains('] },
    { type: 'preset_match_detectors_did_not_hit_any_node', selector: ['.missing-nav'] },
    { type: 'main_content_selectors_failed', selector: ['#missing-content'] },
  ];
  assert.deepEqual(result, expected);
});

test('non-critical: main_content_filters_do_not_apply_to_main_content', () => {
  const $ = makeDoc('<div id="content"><p>Article</p></div>');
  const preset: Preset = {
    preset_match_detectors: ['#content'],
    main_content_selectors: ['#content'],
    main_content_filters: ['.ad'],
  };
  const result = validatePresetNonCritical({ html: $, preset });
  const expected: NonCriticalPresetValidationProblem[] = [
    { type: 'main_content_filters_do_not_apply_to_main_content', selector: ['.ad'] },
  ];
  assert.deepEqual(result, expected);
});

test('non-critical: nth_child_selectors_detected', () => {
  const $ = makeDoc('<ul id="content"><li>1</li><li>2</li></ul>');
  const preset: Preset = {
    preset_match_detectors: ['#content'],
    main_content_selectors: ['#content'],
    main_content_filters: ['li:nth-child(2)'],
  };
  const result = validatePresetNonCritical({ html: $, preset });
  const expected: NonCriticalPresetValidationProblem[] = [
    { type: 'nth_child_selectors_detected', selector: ['li:nth-child(2)'] },
  ];
  assert.deepEqual(result, expected);
});

test('non-critical: contains_pseudo_selector_detected', () => {
  const $ = makeDoc('<div id="content">Hello world</div>');
  const preset: Preset = {
    preset_match_detectors: [':contains(Hello)'],
    main_content_selectors: ['#content'],
    main_content_filters: [],
  };
  const result = validatePresetNonCritical({ html: $, preset });
  const expected: NonCriticalPresetValidationProblem[] = [
    { type: 'contains_pseudo_selector_detected', selector: [':contains(Hello)'] },
  ];
  assert.deepEqual(result, expected);
});

test('non-critical: nested_selectors_detected_in_main_content_selectors', () => {
  const $ = makeDoc('<div id="content"><div class="block"><span class="inner">t</span></div></div>');
  const preset: Preset = {
    preset_match_detectors: ['#content'],
    main_content_selectors: ['#content', '.block', '.inner'],
    main_content_filters: [],
  };
  const result = validatePresetNonCritical({ html: $, preset });
  const expected: NonCriticalPresetValidationProblem[] = [
    { type: 'nested_selectors_detected_in_main_content_selectors', relations: [
      { outer: '#content', inner: '.block' },
      { outer: '.block', inner: '.inner' },
      { outer: '#content', inner: '.inner' },
    ] },
  ];
  assert.deepEqual(result, expected);
});


