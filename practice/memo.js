/**
 * 背稿 view: progressive cloze, read-aloud (speech synthesis) and
 * "say it and check" (speech recognition) for one transcript page.
 */
import { LEVELS, splitSentences, maskSentence, normalise, compareSpeech, missedRuns } from './logic.js';

const PASS_RATIO = 0.85;

/* ---------- speech synthesis (read aloud) ---------- */
let speaking = null; // { cancel: () => void }

function pickVoice() {
  try {
    const voices = speechSynthesis.getVoices();
    return voices.find((v) => /zh[-_]TW/i.test(v.lang)) ?? voices.find((v) => /zh[-_](HK|Hant)/i.test(v.lang)) ?? voices.find((v) => /^zh/i.test(v.lang)) ?? null;
  } catch { return null; }
}

/** @returns {boolean} */
export function ttsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

export function stopSpeaking() {
  speaking?.cancel();
  speaking = null;
}

/**
 * Read sentences one by one, calling onSentence(index) as each starts.
 * @param {string[]} sentences
 * @param {number} rate
 * @param {(index: number) => void} onSentence
 * @param {() => void} onDone
 */
export function speakSentences(sentences, rate, onSentence, onDone) {
  stopSpeaking();
  let cancelled = false;
  speaking = { cancel: () => { cancelled = true; try { speechSynthesis.cancel(); } catch { /* ignore */ } } };
  const voice = pickVoice();
  const next = (index) => {
    if (cancelled) return;
    if (index >= sentences.length) { speaking = null; onDone(); return; }
    const utterance = new SpeechSynthesisUtterance(sentences[index]);
    utterance.lang = voice?.lang ?? 'zh-TW';
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.onstart = () => onSentence(index);
    utterance.onend = () => next(index + 1);
    utterance.onerror = () => next(index + 1);
    speechSynthesis.speak(utterance);
  };
  next(0);
}

/* ---------- speech recognition (say it and check) ---------- */
const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : undefined;

/** @returns {boolean} */
export function recognitionSupported() {
  return !!Recognition;
}

/**
 * Listen until stop() is called; onText receives (finalText, interimText).
 * @param {(finalText: string, interim: string) => void} onText
 * @param {(error: string) => void} onError
 * @returns {{stop: () => Promise<string>}}
 */
export function listen(onText, onError) {
  const recognition = new Recognition();
  recognition.lang = 'zh-TW';
  recognition.continuous = true;
  recognition.interimResults = true;
  let finalText = '';
  let stopping = false;
  let resolveStop = null;
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    onText(finalText, interim);
  };
  recognition.onerror = (event) => { if (event.error !== 'no-speech' && event.error !== 'aborted') onError(event.error); };
  // Some browsers end a session after a pause; restart until the user presses stop.
  recognition.onend = () => {
    if (!stopping) { try { recognition.start(); } catch { /* already restarting */ } return; }
    resolveStop?.(finalText);
  };
  recognition.start();
  return {
    stop: () => new Promise((resolve) => {
      stopping = true;
      resolveStop = resolve;
      try { recognition.stop(); } catch { resolve(finalText); }
    }),
  };
}

/* ---------- rendering ---------- */

/**
 * Sentences of a page that are actually spoken (stage directions removed).
 * @param {{paragraphs: string[]}} page
 * @returns {string[]}
 */
export function spokenSentences(page) {
  return page.paragraphs.flatMap(splitSentences).filter((s) => s.type === 'text').map((s) => s.text);
}

/**
 * Render the page at a cloze level. Hidden parts are tappable to peek.
 * @param {HTMLElement} container
 * @param {{paragraphs: string[], marker?: string}} page
 * @param {number} level
 */
export function renderCloze(container, page, level) {
  container.replaceChildren();
  let sentenceIndex = 0;
  page.paragraphs.forEach((paragraph) => {
    const p = document.createElement('p');
    splitSentences(paragraph).forEach((sentence) => {
      if (sentence.type === 'stage') {
        const stage = document.createElement('span');
        stage.className = 'stage';
        stage.textContent = sentence.text;
        p.append(stage);
        return;
      }
      const span = document.createElement('span');
      span.className = 'sent';
      span.dataset.i = String(sentenceIndex);
      sentenceIndex += 1;
      maskSentence(sentence.text, level).forEach((token) => {
        const piece = document.createElement('span');
        piece.textContent = token.text;
        if (token.hidden) {
          piece.className = 'gap';
          piece.setAttribute('role', 'button');
          piece.setAttribute('aria-label', '點一下偷看');
          piece.addEventListener('click', () => piece.classList.toggle('peek'));
        }
        span.append(piece);
      });
      p.append(span);
    });
    container.append(p);
  });
}

/**
 * Render the full script with the parts that were not said underlined.
 * @param {HTMLElement} container
 * @param {{paragraphs: string[]}} page
 * @param {boolean[]} matched flags over the normalised spoken script
 */
export function renderMissed(container, page, matched) {
  container.replaceChildren();
  let k = 0;
  page.paragraphs.forEach((paragraph) => {
    const p = document.createElement('p');
    splitSentences(paragraph).forEach((sentence) => {
      if (sentence.type === 'stage') {
        const stage = document.createElement('span');
        stage.className = 'stage';
        stage.textContent = sentence.text;
        p.append(stage);
        return;
      }
      let run = null;
      let runMissed = null;
      const flush = () => { if (run) { p.append(run); run = null; runMissed = null; } };
      [...sentence.text].forEach((ch) => {
        const counted = normalise(ch) !== '';
        const missed = counted ? !matched[k] : (runMissed ?? false);
        if (counted) k += 1;
        if (run && missed !== runMissed) flush();
        if (!run) { run = document.createElement('span'); if (missed) run.className = 'miss'; runMissed = missed; }
        run.textContent += ch;
      });
      flush();
    });
    container.append(p);
  });
}

/**
 * Score a spoken attempt against a page.
 * @param {{paragraphs: string[]}} page
 * @param {string} spoken
 */
export function scoreAttempt(page, spoken) {
  const { ratio, matched, chars } = compareSpeech(spokenSentences(page).join(''), spoken);
  return { ratio, matched, missed: missedRuns(chars, matched, 2), passed: ratio >= PASS_RATIO };
}

export { LEVELS, PASS_RATIO };
