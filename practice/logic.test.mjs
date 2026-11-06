import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatTime, pageTarget, filterPages, splitStage, summarizeRun, timeState, shuffle } from './logic.js';

const data = JSON.parse(readFileSync(new URL('./data.json', import.meta.url), 'utf8'));

test('formatTime renders m:ss and negatives', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(59.6), '1:00');
  assert.equal(formatTime(119), '1:59');
  assert.equal(formatTime(-7), '-0:07');
});

test('pageTarget uses the transcript window', () => {
  assert.equal(pageTarget({ start: 477, end: 596 }), 119);
  assert.equal(pageTarget({ start: 10, end: 5 }), 0);
});

test('filterPages splits the two speakers', () => {
  assert.equal(filterPages(data.pages, 'all').length, 17);
  assert.deepEqual(filterPages(data.pages, 'ciping').map((p) => p.n), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(filterPages(data.pages, 'yiyun')[0].n, 8);
});

test('splitStage separates stage directions', () => {
  assert.deepEqual(splitStage('先講〔停一拍〕再講'), [
    { type: 'text', text: '先講' },
    { type: 'stage', text: '〔停一拍〕' },
    { type: 'text', text: '再講' },
  ]);
  assert.deepEqual(splitStage('〔可省〕'), [{ type: 'stage', text: '〔可省〕' }]);
});

test('summarizeRun totals actual against target', () => {
  const pages = [{ n: 1, title: 'a', start: 0, end: 60 }, { n: 2, title: 'b', start: 60, end: 90 }];
  const result = summarizeRun(pages, [70, 20]);
  assert.equal(result.actual, 90);
  assert.equal(result.target, 90);
  assert.equal(result.delta, 0);
  assert.deepEqual(result.rows.map((r) => r.delta), [10, -10]);
});

test('timeState flags near and over', () => {
  assert.equal(timeState(10, 60), 'ok');
  assert.equal(timeState(55, 60), 'near');
  assert.equal(timeState(61, 60), 'over');
});

test('shuffle keeps every item and does not mutate', () => {
  const items = [1, 2, 3, 4, 5];
  const out = shuffle(items, () => 0);
  assert.deepEqual([...out].sort(), items);
  assert.deepEqual(items, [1, 2, 3, 4, 5]);
});

test('snapshot matches the final transcript', () => {
  assert.equal(data.pages.at(-1).end, 1079);
  assert.equal(data.qa.length, 7);
  assert.ok(data.pages.every((p) => p.paragraphs.length > 0));
});
