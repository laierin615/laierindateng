/**
 * Pure helpers for the Dateng rehearsal app. No DOM access here, so the
 * functions can be unit-tested with `node --test practice/logic.test.mjs`.
 */

/** Speaker filter keys used across the app. */
export const SPEAKERS = Object.freeze({ all: '全部', ciping: '慧麗 1–7', yiyun: '奕芸 8–17' });

/**
 * Format seconds as m:ss (negative values get a leading minus).
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  const sign = seconds < 0 ? '-' : '';
  const total = Math.round(Math.abs(seconds));
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return `${sign}${minutes}:${rest}`;
}

/**
 * Target speaking time for one page, from the transcript's time window.
 * @param {{start: number, end: number}} page
 * @returns {number} seconds
 */
export function pageTarget(page) {
  return Math.max(0, page.end - page.start);
}

/**
 * Pages for the chosen speaker ('all' keeps everything).
 * @template {{speaker: string}} T
 * @param {T[]} pages
 * @param {string} speaker
 * @returns {T[]}
 */
export function filterPages(pages, speaker) {
  return speaker === 'all' ? pages : pages.filter((page) => page.speaker === speaker);
}

/**
 * Split a transcript paragraph into spoken text and stage directions (〔…〕).
 * @param {string} paragraph
 * @returns {{type: 'text' | 'stage', text: string}[]}
 */
export function splitStage(paragraph) {
  return paragraph
    .split(/(〔[^〕]*〕)/)
    .filter((part) => part.trim() !== '')
    .map((part) => ({ type: part.startsWith('〔') ? 'stage' : 'text', text: part }));
}

/**
 * Compare a timed run with the targets.
 * @param {{n: number, title: string, start: number, end: number}[]} pages pages in run order
 * @param {number[]} actualSeconds seconds spent on each page, same order
 * @returns {{rows: {n: number, title: string, actual: number, target: number, delta: number}[], actual: number, target: number, delta: number}}
 */
export function summarizeRun(pages, actualSeconds) {
  const rows = pages.map((page, index) => {
    const actual = actualSeconds[index] ?? 0;
    const target = pageTarget(page);
    return { n: page.n, title: page.title, actual, target, delta: actual - target };
  });
  const actual = rows.reduce((sum, row) => sum + row.actual, 0);
  const target = rows.reduce((sum, row) => sum + row.target, 0);
  return { rows, actual, target, delta: actual - target };
}

/**
 * Traffic-light state for time spent against a target.
 * @param {number} actual
 * @param {number} target
 * @returns {'ok' | 'near' | 'over'}
 */
export function timeState(actual, target) {
  if (actual > target) return 'over';
  if (actual > target * 0.85) return 'near';
  return 'ok';
}

/**
 * Fisher–Yates shuffle that never mutates its input.
 * @template T
 * @param {T[]} items
 * @param {() => number} [random] injectable for tests
 * @returns {T[]}
 */
export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
