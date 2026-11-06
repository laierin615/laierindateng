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

import { splitSentences, maskSentence, normalise, compareSpeech, missedRuns } from './logic.js';

test('splitSentences keeps stage directions and splits on 。！？；', () => {
  assert.deepEqual(splitSentences('第一句。第二句！〔停一拍〕第三句'), [
    { type: 'text', text: '第一句。' }, { type: 'text', text: '第二句！' },
    { type: 'stage', text: '〔停一拍〕' }, { type: 'text', text: '第三句' },
  ]);
});

const visible = (tokens) => tokens.filter((t) => !t.hidden).map((t) => t.text).join('');
const hidden = (tokens) => tokens.filter((t) => t.hidden).map((t) => t.text).join('');

test('maskSentence fades a sentence level by level', () => {
  const s = '野菜苦苦的，為什麼煮成湯卻很好喝？';
  assert.equal(visible(maskSentence(s, 0)), s);
  assert.equal(visible(maskSentence(s, 1)), '野菜苦，為什麼煮成？');
  assert.equal(visible(maskSentence(s, 2)), '野菜，為什？');
  assert.equal(visible(maskSentence(s, 3)), '野，為？');
  assert.equal(visible(maskSentence(s, 4)), '，？');
  assert.equal(visible(maskSentence(s, 4)) + hidden(maskSentence(s, 4)), '，？野菜苦苦的為什麼煮成湯卻很好喝');
});

test('maskSentence never hides punctuation or quotes', () => {
  const tokens = maskSentence('老師只問一句：「你說的苦，一樣嗎？」', 4);
  assert.equal(visible(tokens), '：「，？」');
});

test('normalise drops punctuation, spaces and stage directions', () => {
  assert.equal(normalise('Aray，謝謝 大家。〔停一拍〕'), 'aray謝謝大家');
});

test('compareSpeech scores coverage and finds the missed part', () => {
  const script = '土地養野菜，野菜養孩子，孩子把知識傳下去。';
  const full = compareSpeech(script, '土地養野菜 野菜養孩子 孩子把知識傳下去');
  assert.equal(full.ratio, 1);
  const partial = compareSpeech(script, '土地養野菜，孩子把知識傳下去');
  assert.ok(partial.ratio > 0.6 && partial.ratio < 0.8);
  // repeated words make the exact split ambiguous; the number of missed characters is not
  assert.equal(missedRuns(partial.chars, partial.matched, 1).join('').length, 5);
  assert.equal(partial.matched.filter((hit) => !hit).length, 5);
});

import { applyEdits, textToParagraphs, exportText } from './logic.js';

test('applyEdits overlays edited pages without touching the snapshot', () => {
  const pages = [{ n: 1, title: 'a', paragraphs: ['原稿'] }, { n: 2, title: 'b', paragraphs: ['二'] }];
  const out = applyEdits(pages, { 1: { paragraphs: ['新稿'], at: 0 } });
  assert.deepEqual(out.map((p) => [p.paragraphs[0], p.edited]), [['新稿', true], ['二', false]]);
  assert.equal(pages[0].paragraphs[0], '原稿');
});

test('textToParagraphs splits on blank lines', () => {
  assert.deepEqual(textToParagraphs('第一段\n接著\n\n\n第二段\r\n'), ['第一段 接著', '第二段']);
  assert.deepEqual(textToParagraphs('   \n\n  '), []);
});

test('exportText lists only edited pages', () => {
  const pages = [{ n: 1, title: '封面' }, { n: 2, title: '問題' }];
  assert.equal(exportText(pages, {}), '');
  assert.equal(exportText(pages, { 2: { paragraphs: ['甲', '乙'], at: 0 } }), '第 2 頁｜問題\n\n甲\n\n乙');
});
