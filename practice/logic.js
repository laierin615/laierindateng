/**
 * Pure helpers for the Dateng rehearsal app. No DOM access here, so the
 * functions can be unit-tested with `node --test practice/logic.test.mjs`.
 */

/** Speaker filter keys used across the app. */
export const SPEAKERS = Object.freeze({ all: '全部', ciping: '慧麗 1–7', yiyun: '奕芸 8–16' });

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

/* ---------- script versions ---------- */

/**
 * Swap in an alternative wording for some pages (e.g. the stand-up version of 8–16).
 * Pages the version does not cover keep the final transcript.
 * @template {{n: number, paragraphs: string[]}} T
 * @param {T[]} pages
 * @param {{pages: Record<string, string[]>} | null} version
 * @returns {(T & {version: boolean})[]}
 */
export function applyVersion(pages, version) {
  return pages.map((page) => {
    const paragraphs = version?.pages?.[page.n];
    return paragraphs ? { ...page, paragraphs, version: true } : { ...page, version: false };
  });
}

/* ---------- on-device edits ---------- */

/**
 * Overlay the user's on-device edits onto the transcript snapshot.
 * @template {{n: number, paragraphs: string[]}} T
 * @param {T[]} pages
 * @param {Record<string, {paragraphs: string[]}>} edits keyed by page number
 * @returns {(T & {edited: boolean})[]}
 */
export function applyEdits(pages, edits) {
  return pages.map((page) => {
    const edit = edits?.[page.n];
    return edit ? { ...page, paragraphs: edit.paragraphs, edited: true } : { ...page, edited: false };
  });
}

/**
 * Textarea text → paragraphs (blank lines separate paragraphs; single line breaks are kept as spaces).
 * @param {string} text
 * @returns {string[]}
 */
export function textToParagraphs(text) {
  return text.replace(/\r/g, '').split(/\n\s*\n/).map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean).join(' ')).filter(Boolean);
}

/**
 * Plain-text export of every edited page, ready to paste back into the Google Doc.
 * @param {{n: number, title: string}[]} pages
 * @param {Record<string, {paragraphs: string[], at: number}>} edits
 * @returns {string} empty when nothing was edited
 */
export function exportText(pages, edits) {
  return pages
    .filter((page) => edits?.[page.n])
    .map((page) => `第 ${page.n} 頁｜${page.title}\n\n${edits[page.n].paragraphs.join('\n\n')}`)
    .join('\n\n――――――\n\n');
}

/* ---------- memorisation helpers ---------- */

/** Labels for the progressive-cloze levels. */
export const LEVELS = Object.freeze(['全文', '藏後半', '前兩字', '只留首字', '全藏']);

const SENTENCE_END = /(?<=[。！？；])/;
const CLAUSE_BREAK = /([，、：「」『』（）—…\s]+)/;
const PUNCT = /[\s，、。！？；：「」『』（）〔〕—…,.!?;:'"()\-]/g;

/**
 * Split one transcript paragraph into sentences, keeping stage directions apart.
 * @param {string} paragraph
 * @returns {{type: 'text' | 'stage', text: string}[]}
 */
export function splitSentences(paragraph) {
  return splitStage(paragraph).flatMap((part) => (part.type === 'stage'
    ? [part]
    : part.text.split(SENTENCE_END).filter((s) => s.trim() !== '').map((text) => ({ type: 'text', text }))));
}

/**
 * How many leading characters of a clause stay visible at a level.
 * @param {number} length clause length
 * @param {number} level 0–4
 * @returns {number}
 */
function visibleChars(length, level) {
  if (level <= 0) return length;
  if (level === 1) return Math.ceil(length / 2);
  if (level === 2) return Math.min(2, length);
  if (level === 3) return Math.min(1, length);
  return 0;
}

/**
 * Mask a sentence for progressive cloze. Punctuation always stays visible;
 * each clause keeps a number of leading characters that shrinks with the level.
 * @param {string} sentence
 * @param {number} level 0 (all shown) … 4 (all hidden)
 * @returns {{text: string, hidden: boolean}[]}
 */
export function maskSentence(sentence, level) {
  return sentence.split(CLAUSE_BREAK).filter((piece) => piece !== '').flatMap((piece) => {
    if (CLAUSE_BREAK.test(piece) && piece.replace(CLAUSE_BREAK, '') === '') return [{ text: piece, hidden: false }];
    const tail = piece.match(/[。！？；]+$/)?.[0] ?? '';
    const body = tail ? piece.slice(0, -tail.length) : piece;
    const keep = visibleChars([...body].length, level);
    const chars = [...body];
    const tokens = [];
    if (keep > 0) tokens.push({ text: chars.slice(0, keep).join(''), hidden: false });
    if (keep < chars.length) tokens.push({ text: chars.slice(keep).join(''), hidden: true });
    if (tail) tokens.push({ text: tail, hidden: false });
    return tokens;
  });
}

/**
 * Normalise text for comparison: drop punctuation, spaces and stage directions.
 * @param {string} text
 * @returns {string}
 */
export function normalise(text) {
  return text.replace(/〔[^〕]*〕/g, '').replace(PUNCT, '').toLowerCase();
}

/**
 * Compare what was said with the script (longest common subsequence on characters).
 * @param {string} script
 * @param {string} spoken
 * @returns {{ratio: number, matched: boolean[], chars: string[]}} matched flags per script character (normalised)
 */
export function compareSpeech(script, spoken) {
  const a = [...normalise(script)];
  const b = [...normalise(spoken)];
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  const matched = new Array(a.length).fill(false);
  // Walk back preferring to skip script characters while the score allows it, so repeated
  // phrases are matched to their earliest occurrence and the missed part stays contiguous.
  for (let i = a.length, j = b.length; i > 0 && j > 0;) {
    if (table[i - 1][j] === table[i][j]) i -= 1;
    else if (a[i - 1] === b[j - 1]) { matched[i - 1] = true; i -= 1; j -= 1; } else j -= 1;
  }
  const hits = matched.filter(Boolean).length;
  return { ratio: a.length ? hits / a.length : 1, matched, chars: a };
}

/**
 * Turn per-character match flags back into readable runs of missed text.
 * @param {string[]} chars normalised script characters
 * @param {boolean[]} matched
 * @param {number} [minLength] ignore tiny gaps (single characters are usually recognition noise)
 * @returns {string[]}
 */
export function missedRuns(chars, matched, minLength = 3) {
  const runs = [];
  let current = '';
  chars.forEach((ch, index) => {
    if (!matched[index]) current += ch;
    else { if ([...current].length >= minLength) runs.push(current); current = ''; }
  });
  if ([...current].length >= minLength) runs.push(current);
  return runs;
}
