import { formatTime, pageTarget, filterPages, splitStage, summarizeRun, timeState, shuffle, applyEdits, textToParagraphs, exportText } from './logic.js';
import { recordingSupported, loadRecording, saveRecording, deleteRecording, clearRecordings, startRecording } from './recorder.js';
import { LEVELS, PASS_RATIO, ttsSupported, speakSentences, stopSpeaking, recognitionSupported, listen, spokenSentences, renderCloze, renderMissed, scoreAttempt } from './memo.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const shot = (n) => `../forum/shots/s${String(n).padStart(2, '0')}.jpg`;

/* ---------- tiny persistent store (per-device conveniences only) ---------- */
const store = {
  get(key, fallback) {
    try { const raw = localStorage.getItem(`dateng-practice:${key}`); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`dateng-practice:${key}`, JSON.stringify(value)); } catch { /* private mode: keep going */ }
  },
};

const state = {
  data: null,
  view: store.get('view', 'read'),
  speaker: store.get('speaker', 'all'),
  readIndex: store.get('readIndex', 0),
  recallIndex: 0,
  recallOnlyBad: false,
  recallMarks: store.get('recallMarks', {}),
  quizOrder: [],
  quizIndex: 0,
  quizMarks: store.get('quizMarks', {}),
  timer: null,
  memoIndex: store.get('memoIndex', 0),
  memoLevel: store.get('memoLevel', 1),
  memoBest: store.get('memoBest', {}),
  listening: null,
  edits: store.get('edits', {}),
  editing: null,
};

/* ---------- rendering helpers ---------- */
function renderScript(container, page) {
  container.replaceChildren();
  if (page.marker) {
    const marker = document.createElement('p');
    marker.className = 'marker';
    marker.textContent = page.marker;
    container.append(marker);
  }
  page.paragraphs.forEach((paragraph) => {
    const p = document.createElement('p');
    splitStage(paragraph).forEach((part) => {
      const span = document.createElement('span');
      if (part.type === 'stage') span.className = 'stage';
      span.textContent = part.text;
      p.append(span);
    });
    container.append(p);
  });
}

function renderAnswer(container, lines) {
  container.replaceChildren(...lines.map((line) => {
    const p = document.createElement('p');
    splitStage(line).forEach((part) => {
      const span = document.createElement('span');
      if (part.type === 'stage') span.className = 'stage';
      span.textContent = part.text;
      p.append(span);
    });
    return p;
  }));
}

const visiblePages = () => filterPages(applyEdits(state.data.pages, state.edits), state.speaker);
const clampIndex = (index, length) => Math.min(Math.max(index, 0), Math.max(length - 1, 0));

/* ---------- recording widget ---------- */
let activeRecording = null;

async function stopActiveRecording() {
  if (!activeRecording) return;
  const { key, handle, refresh } = activeRecording;
  activeRecording = null;
  try {
    const result = await handle.stop();
    await saveRecording(key, { ...result, at: Date.now() });
  } catch (error) {
    alert(`錄音儲存失敗：${error.message ?? error}`);
  }
  refresh();
}

async function mountRecorder(container, key) {
  if (!container) return;
  if (!recordingSupported()) {
    container.innerHTML = '<span class="state">這個瀏覽器不支援錄音</span>';
    return;
  }
  const refresh = () => mountRecorder(container, key);
  const saved = await loadRecording(key);
  const isLive = activeRecording?.key === key;
  container.replaceChildren();
  const label = document.createElement('span');
  label.className = 'state';
  label.textContent = isLive ? '● 錄音中…' : saved ? `已錄 ${formatTime(saved.seconds)}` : '練習錄音（只存在這支手機）';
  const recordBtn = document.createElement('button');
  recordBtn.type = 'button';
  recordBtn.textContent = isLive ? '■ 停止' : saved ? '● 重錄' : '● 錄音';
  if (isLive) recordBtn.classList.add('live');
  recordBtn.addEventListener('click', async () => {
    if (isLive) { await stopActiveRecording(); return; }
    await stopActiveRecording();
    try {
      const handle = await startRecording();
      activeRecording = { key, handle, refresh };
      refresh();
    } catch (error) {
      alert(`無法開始錄音，請確認已允許麥克風：${error.message ?? error}`);
    }
  });
  container.append(label, recordBtn);
  if (saved && !isLive) {
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.textContent = '▶ 播放';
    playBtn.addEventListener('click', () => {
      const url = URL.createObjectURL(saved.blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.play().catch((error) => alert(`播放失敗：${error.message ?? error}`));
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '刪除';
    deleteBtn.addEventListener('click', async () => {
      try { await deleteRecording(key); } catch (error) { alert(`刪除失敗：${error.message ?? error}`); }
      refresh();
    });
    container.append(playBtn, deleteBtn);
  }
}

/* ---------- ① 逐頁讀稿 ---------- */
function renderRead() {
  const pages = visiblePages();
  state.readIndex = clampIndex(state.readIndex, pages.length);
  store.set('readIndex', state.readIndex);
  const page = pages[state.readIndex];
  $('#read-img').src = shot(page.n);
  $('#read-img').alt = `第 ${page.n} 頁投影片`;
  $('#read-no').textContent = `第 ${page.n} 頁`;
  $('#read-speaker').textContent = page.speakerLabel;
  $('#read-speaker').className = `chip ${page.speaker}`;
  $('#read-target').textContent = `目標 ${formatTime(pageTarget(page))}`;
  $('#read-title').textContent = page.title;
  $('#read-edited').hidden = !page.edited;
  $('#read-count').textContent = `${state.readIndex + 1} / ${pages.length}`;
  renderScript($('#read-script'), page);
  mountRecorder($('[data-rec="read"]'), `page-${page.n}`);
}

/* ---------- 🧠 背稿 ---------- */
function memoPage() {
  const pages = visiblePages();
  state.memoIndex = clampIndex(state.memoIndex, pages.length);
  return pages[state.memoIndex];
}

function stopMemoAudio() {
  stopSpeaking();
  $('#memo-tts').textContent = '🔊 朗讀';
  $$('#memo-script .sent.speaking').forEach((el) => el.classList.remove('speaking'));
  if (state.listening) {
    const { session } = state.listening;
    state.listening = null;
    session.stop().catch(() => {});
    $('#memo-listen').textContent = '🎙 說說看・對稿';
    $('#memo-live').hidden = true;
  }
}

function renderMemo() {
  const pages = visiblePages();
  const page = memoPage();
  store.set('memoIndex', state.memoIndex);
  $('#memo-img').src = shot(page.n);
  $('#memo-img').alt = `第 ${page.n} 頁投影片`;
  $('#memo-no').textContent = `第 ${page.n} 頁・${page.speakerLabel}`;
  const best = state.memoBest[page.n];
  $('#memo-best').textContent = best === undefined ? '還沒通過' : `已通過 L${best}`;
  $('#memo-best').className = `chip ${best === undefined ? '' : 'yiyun'}`;
  $('#memo-edited').hidden = !page.edited;
  $('#memo-title').textContent = page.title;
  $('#memo-count').textContent = `${state.memoIndex + 1} / ${pages.length}`;
  $('#memo-levels').replaceChildren(...LEVELS.map((label, level) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<small>L${level}</small>${label}`;
    button.setAttribute('aria-pressed', String(level === state.memoLevel));
    button.addEventListener('click', () => { stopMemoAudio(); state.memoLevel = level; store.set('memoLevel', level); renderMemo(); });
    return button;
  }));
  $('#memo-level-note').textContent = [
    '先把整頁讀熟，可以按「朗讀」用聽的。',
    '每個分句只留前半，後半自己接上。',
    '每個分句只留前兩個字當提示。',
    '每個分句只剩第一個字。',
    '全部藏起來，只剩標點。點灰色空格可以偷看。',
  ][state.memoLevel];
  $('#memo-result').hidden = true;
  $('#memo-pass').textContent = `✓ L${state.memoLevel} 講順了`;
  renderCloze($('#memo-script'), page, state.memoLevel);
  $('#memo-tts').disabled = !ttsSupported();
  if (!recognitionSupported()) { $('#memo-listen').disabled = true; $('#memo-listen').textContent = '🎙 此瀏覽器不支援對稿'; }
  $('#memo-dots').replaceChildren(...pages.map((p) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    const level = state.memoBest[p.n];
    dot.textContent = p.n;
    dot.title = level === undefined ? '還沒通過' : `已通過 L${level}`;
    if (level !== undefined) dot.classList.add(level >= 3 ? 'ok' : 'bad');
    if (p.n === page.n) dot.setAttribute('aria-current', 'true');
    dot.addEventListener('click', () => { stopMemoAudio(); state.memoIndex = pages.findIndex((x) => x.n === p.n); renderMemo(); });
    return dot;
  }));
}

function markMemoPassed(page, level) {
  const best = state.memoBest[page.n];
  if (best === undefined || level > best) {
    state.memoBest[page.n] = level;
    store.set('memoBest', state.memoBest);
  }
}

function showMemoResult(page, result) {
  const box = $('#memo-result');
  const percent = Math.round(result.ratio * 100);
  const nextLevel = Math.min(state.memoLevel + 1, LEVELS.length - 1);
  box.innerHTML = `<div class="score ${result.passed ? 'pass' : 'fail'}">${percent}%</div>
    <p class="note">${result.passed ? `講到 ${percent}%，L${state.memoLevel} 通過！` : `差一點，${Math.round(PASS_RATIO * 100)}% 才算通過。下面紅色是沒講到的地方。`}</p>`;
  if (result.passed && state.memoLevel < LEVELS.length - 1) {
    const up = document.createElement('button');
    up.type = 'button'; up.className = 'primary'; up.textContent = `挑戰 L${nextLevel}（${LEVELS[nextLevel]}）`;
    up.addEventListener('click', () => { state.memoLevel = nextLevel; store.set('memoLevel', nextLevel); renderMemo(); });
    box.append(up);
  }
  const again = document.createElement('button');
  again.type = 'button'; again.className = 'ghost'; again.textContent = '回到挖空畫面'; again.style.marginLeft = '8px';
  again.addEventListener('click', renderMemo);
  box.append(again);
  box.hidden = false;
  if (result.passed) markMemoPassed(page, state.memoLevel);
  renderMissed($('#memo-script'), page, result.matched);
  $('#memo-best').textContent = state.memoBest[page.n] === undefined ? '還沒通過' : `已通過 L${state.memoBest[page.n]}`;
}

function toggleSpeak() {
  if ($('#memo-tts').textContent.startsWith('■')) { stopMemoAudio(); return; }
  stopMemoAudio();
  const page = memoPage();
  const rate = Number($('#memo-rate').value);
  $('#memo-tts').textContent = '■ 停止朗讀';
  speakSentences(spokenSentences(page), rate, (index) => {
    $$('#memo-script .sent').forEach((el) => el.classList.toggle('speaking', el.dataset.i === String(index)));
    $(`#memo-script .sent[data-i="${index}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, () => stopMemoAudio());
}

async function toggleListen() {
  const page = memoPage();
  if (state.listening) {
    const { session } = state.listening;
    state.listening = null;
    $('#memo-listen').textContent = '🎙 說說看・對稿';
    $('#memo-live').textContent = '比對中…';
    const spoken = await session.stop();
    $('#memo-live').hidden = true;
    if (!spoken.trim()) { alert('沒有聽到聲音，請再試一次，講話時靠近手機一點。'); return; }
    showMemoResult(page, scoreAttempt(page, spoken));
    return;
  }
  stopSpeaking();
  try {
    const session = listen((finalText, interim) => {
      $('#memo-live').textContent = `${finalText}${interim}` || '在聽了，請開始講…';
    }, (error) => {
      const tips = { 'not-allowed': '麥克風沒有開權限', network: '對稿需要網路連線', 'service-not-allowed': '這個瀏覽器不允許語音辨識' };
      alert(`對稿停止：${tips[error] ?? error}`);
      stopMemoAudio();
    });
    state.listening = { session };
    $('#memo-listen').textContent = '■ 講完了，對稿';
    $('#memo-live').textContent = '在聽了，請開始講…';
    $('#memo-live').hidden = false;
    $('#memo-result').hidden = true;
  } catch (error) {
    alert(`無法開始對稿：${error.message ?? error}`);
  }
}

/* ---------- ✏️ 修稿 (edits stay on this device until exported) ---------- */
function openEditor(page) {
  stopMemoAudio();
  state.editing = page.n;
  $('#edit-title').textContent = `修稿｜第 ${page.n} 頁 ${page.title}`;
  $('#edit-text').value = page.paragraphs.join('\n\n');
  $('#edit-restore').hidden = !page.edited;
  $('#editor').showModal();
}

function saveEditor() {
  const n = state.editing;
  const paragraphs = textToParagraphs($('#edit-text').value);
  const original = state.data.pages.find((p) => p.n === n);
  if (!paragraphs.length) { alert('講稿不能是空的。'); return; }
  if (paragraphs.join('\n') === original.paragraphs.join('\n')) delete state.edits[n];
  else state.edits[n] = { paragraphs, at: Date.now() };
  store.set('edits', state.edits);
  $('#editor').close();
  render();
}

function restoreEditor() {
  if (!confirm('放棄這頁的修改，回到定稿？')) return;
  delete state.edits[state.editing];
  store.set('edits', state.edits);
  $('#editor').close();
  render();
}

async function exportEdits() {
  const text = exportText(state.data.pages, state.edits);
  if (!text) { alert('還沒有修改過任何一頁。'); return; }
  try {
    if (navigator.share) { await navigator.share({ title: 'Dateng 修稿', text }); return; }
  } catch (error) {
    if (error?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(text);
    alert(`已複製 ${Object.keys(state.edits).length} 頁修稿，可以直接貼到 Google 文件。`);
  } catch {
    $('#export-text').value = text;
    $('#export').showModal();
  }
}

/* ---------- ② 提詞回想 ---------- */
function recallPages() {
  const pages = visiblePages();
  if (!state.recallOnlyBad) return pages;
  const bad = pages.filter((page) => state.recallMarks[page.n] === 'bad');
  return bad.length ? bad : pages;
}

function renderRecall() {
  const pages = recallPages();
  state.recallIndex = clampIndex(state.recallIndex, pages.length);
  const page = pages[state.recallIndex];
  $('#recall-img').src = shot(page.n);
  $('#recall-img').alt = `第 ${page.n} 頁投影片`;
  $('#recall-no').textContent = `第 ${page.n} 頁・${page.speakerLabel}`;
  $('#recall-target').textContent = `目標 ${formatTime(pageTarget(page))}`;
  $('#recall-title').textContent = page.title;
  $('#recall-cover').hidden = false;
  $('#recall-answer').hidden = true;
  renderScript($('#recall-script'), page);
  $('#recall-only-bad').textContent = state.recallOnlyBad ? '練全部的頁' : '只練卡住的頁';
  $('#recall-dots').replaceChildren(...visiblePages().map((p) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.textContent = p.n;
    const mark = state.recallMarks[p.n];
    if (mark) dot.classList.add(mark);
    if (p.n === page.n) dot.setAttribute('aria-current', 'true');
    dot.addEventListener('click', () => {
      state.recallOnlyBad = false;
      state.recallIndex = visiblePages().findIndex((x) => x.n === p.n);
      renderRecall();
    });
    return dot;
  }));
  mountRecorder($('[data-rec="recall"]'), `page-${page.n}`);
}

/* ---------- ③ 整場計時 ---------- */
function timerPlanText() {
  const pages = visiblePages();
  const total = pages.reduce((sum, page) => sum + pageTarget(page), 0);
  return `${pages.length} 頁（第 ${pages[0].n}–${pages.at(-1).n} 頁），目標 ${formatTime(total)}。`;
}

function elapsedOnPage(timer) {
  const now = timer.pausedAt ?? performance.now();
  return (now - timer.pageStartedAt) / 1000;
}

function renderTimerFrame() {
  const timer = state.timer;
  if (!timer) return;
  const page = timer.pages[timer.index];
  const spent = elapsedOnPage(timer);
  const target = pageTarget(page);
  const status = timeState(spent, target);
  $('#timer-clock').textContent = formatTime(spent);
  $('#timer-clock').className = `clock ${status === 'ok' ? '' : status}`;
  $('#timer-bar').style.width = `${Math.min(100, (spent / Math.max(target, 1)) * 100)}%`;
  $('#timer-bar').className = status === 'ok' ? '' : status;
  const total = timer.splits.reduce((sum, value) => sum + value, 0) + spent;
  const totalTarget = timer.pages.reduce((sum, p) => sum + pageTarget(p), 0);
  $('#timer-total').textContent = `總計 ${formatTime(total)}`;
  $('#timer-total-target').textContent = `目標 ${formatTime(totalTarget)}`;
}

function showTimerPage() {
  const timer = state.timer;
  const page = timer.pages[timer.index];
  $('#timer-img').src = shot(page.n);
  $('#timer-img').alt = `第 ${page.n} 頁投影片`;
  $('#timer-no').textContent = `第 ${page.n} 頁・${timer.index + 1} / ${timer.pages.length}`;
  $('#timer-title').textContent = page.title;
  $('#timer-target').textContent = `這頁目標 ${formatTime(pageTarget(page))}`;
  $('#timer-next').textContent = timer.index === timer.pages.length - 1 ? '講完了 ✓' : '下一頁 ›';
  renderTimerFrame();
}

function startTimer() {
  const pages = visiblePages();
  state.timer = { pages, index: 0, splits: [], pageStartedAt: performance.now(), pausedAt: null, interval: setInterval(renderTimerFrame, 250) };
  $('#timer-idle').hidden = true;
  $('#timer-result').hidden = true;
  $('#timer-run').hidden = false;
  $('#timer-pause').textContent = '暫停';
  requestWakeLock();
  showTimerPage();
}

function nextTimerPage() {
  const timer = state.timer;
  if (!timer || timer.pausedAt) return;
  timer.splits.push(elapsedOnPage(timer));
  if (timer.index === timer.pages.length - 1) { finishTimer(); return; }
  timer.index += 1;
  timer.pageStartedAt = performance.now();
  showTimerPage();
}

function togglePause() {
  const timer = state.timer;
  if (!timer) return;
  if (timer.pausedAt) {
    timer.pageStartedAt += performance.now() - timer.pausedAt;
    timer.pausedAt = null;
    $('#timer-pause').textContent = '暫停';
  } else {
    timer.pausedAt = performance.now();
    $('#timer-pause').textContent = '繼續';
  }
  renderTimerFrame();
}

function finishTimer() {
  const timer = state.timer;
  if (!timer) return;
  clearInterval(timer.interval);
  if (timer.splits.length < timer.pages.length && timer.splits.length === timer.index) timer.splits.push(elapsedOnPage(timer));
  const done = timer.pages.slice(0, timer.splits.length);
  const summary = summarizeRun(done, timer.splits);
  const run = { at: Date.now(), speaker: state.speaker, complete: done.length === timer.pages.length, ...summary };
  store.set('lastRun', run);
  state.timer = null;
  releaseWakeLock();
  $('#timer-run').hidden = true;
  $('#timer-idle').hidden = false;
  renderRunResult($('#timer-result'), run);
  $('#timer-result').hidden = false;
  renderTimerIdle();
}

function renderRunResult(container, run) {
  const when = new Date(run.at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const rows = run.rows.map((row) => {
    const cls = row.delta > 5 ? 'over' : row.delta < -5 ? 'under' : '';
    const sign = row.delta > 0 ? '+' : '';
    return `<tr><td>${row.n}</td><td>${escapeHtml(row.title)}</td><td class="num">${formatTime(row.actual)}</td><td class="num">${formatTime(row.target)}</td><td class="num ${cls}">${sign}${formatTime(row.delta)}</td></tr>`;
  }).join('');
  const sign = run.delta > 0 ? '+' : '';
  container.innerHTML = `<div class="card"><p class="q">上次計時結果</p><p class="note">${when}・${run.complete ? '完整講完' : '中途結束'}・總計 ${formatTime(run.actual)}／目標 ${formatTime(run.target)}（${sign}${formatTime(run.delta)}）</p>
    <table><thead><tr><th>頁</th><th>標題</th><th class="num">實際</th><th class="num">目標</th><th class="num">差</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note">紅字＝超過目標 5 秒以上，綠字＝快了 5 秒以上。</p></div>`;
}

function renderTimerIdle() {
  $('#timer-plan').textContent = timerPlanText();
  const last = store.get('lastRun', null);
  if (last && $('#timer-result').hidden) renderRunResult($('#timer-last'), last);
  else $('#timer-last').replaceChildren();
}

/* ---------- ④ 座談抽考 ---------- */
function reshuffleQuiz() {
  state.quizOrder = shuffle(state.data.qa.map((_, index) => index));
  state.quizIndex = 0;
}

function renderQuiz() {
  if (!state.quizOrder.length) reshuffleQuiz();
  const item = state.data.qa[state.quizOrder[state.quizIndex]];
  $('#quiz-id').textContent = `${item.id}・第 ${state.quizIndex + 1} / ${state.data.qa.length} 題`;
  $('#quiz-q').textContent = item.q;
  $('#quiz-cover').hidden = false;
  $('#quiz-answer').hidden = true;
  renderAnswer($('#quiz-a'), item.a);
  $('#quiz-dots').replaceChildren(...state.data.qa.map((q) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.textContent = q.id.replace('Q', '');
    const mark = state.quizMarks[q.id];
    if (mark) dot.classList.add(mark);
    if (q.id === item.id) dot.setAttribute('aria-current', 'true');
    dot.addEventListener('click', () => {
      state.quizIndex = state.quizOrder.indexOf(state.data.qa.indexOf(q));
      renderQuiz();
    });
    return dot;
  }));
  mountRecorder($('[data-rec="quiz"]'), `qa-${item.id}`);
}

/* ---------- navigation ---------- */
function render() {
  $$('.view').forEach((view) => { view.hidden = view.id !== `view-${state.view}`; });
  $$('nav.tabs button').forEach((button) => button.toggleAttribute('aria-current', button.dataset.view === state.view));
  $$('nav.tabs button').forEach((button) => { if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page'); });
  $$('#speaker button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.speaker === state.speaker)));
  if (state.view === 'read') renderRead();
  if (state.view === 'recall') renderRecall();
  if (state.view === 'timer' && !state.timer) renderTimerIdle();
  if (state.view === 'quiz') renderQuiz();
  if (state.view === 'memo') renderMemo();
  if (state.view !== 'quiz') requestWakeLock();
  const edited = Object.keys(state.edits).length;
  $('#export-btn').textContent = edited ? `匯出修稿（${edited} 頁）` : '匯出修稿（還沒有修改）';
}

async function switchView(view) {
  if (state.timer && view !== 'timer' && !confirm('計時進行中，要結束這次計時嗎？')) return;
  if (state.timer && view !== 'timer') finishTimer();
  await stopActiveRecording();
  stopMemoAudio();
  state.view = view;
  store.set('view', view);
  render();
  window.scrollTo({ top: 0 });
}

async function step(delta) {
  await stopActiveRecording();
  if (state.view === 'read') { state.readIndex += delta; renderRead(); }
  if (state.view === 'recall') { state.recallIndex += delta; renderRecall(); }
  if (state.view === 'memo') { stopMemoAudio(); state.memoIndex += delta; renderMemo(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

/* ---------- screen wake lock (keeps the phone awake while practising) ---------- */
let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* not allowed: fine */ }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* ignore */ }
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.view !== 'quiz') requestWakeLock(); });

/* ---------- settings ---------- */
function applyDisplay() {
  const fontSize = store.get('fontSize', 18);
  document.documentElement.style.setProperty('--fs', `${fontSize}px`);
  $('#fs').value = fontSize;
  $('#fs-val').textContent = `${fontSize}px`;
  const theme = store.get('theme', 'auto');
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
  $$('#theme button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.theme === theme)));
}

/* ---------- wiring ---------- */
function bindEvents() {
  $$('nav.tabs button').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('#speaker button').forEach((button) => button.addEventListener('click', async () => {
    if (state.timer) return;
    await stopActiveRecording();
    state.speaker = button.dataset.speaker;
    store.set('speaker', state.speaker);
    stopMemoAudio();
    state.readIndex = 0;
    state.recallIndex = 0;
    state.memoIndex = 0;
    render();
  }));
  $$('[data-step]').forEach((button) => button.addEventListener('click', () => step(Number(button.dataset.step))));
  $$('[data-swipe]').forEach((element) => {
    let startX = null;
    element.addEventListener('touchstart', (event) => { startX = event.touches[0].clientX; }, { passive: true });
    element.addEventListener('touchend', (event) => {
      if (startX === null) return;
      const dx = event.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    });
  });

  $('#recall-reveal').addEventListener('click', () => { $('#recall-cover').hidden = true; $('#recall-answer').hidden = false; });
  $$('[data-mark]').forEach((button) => button.addEventListener('click', async () => {
    const page = recallPages()[state.recallIndex];
    state.recallMarks[page.n] = button.dataset.mark;
    store.set('recallMarks', state.recallMarks);
    await stopActiveRecording();
    if (state.recallOnlyBad && button.dataset.mark === 'ok') state.recallIndex = clampIndex(state.recallIndex, recallPages().length);
    else state.recallIndex = (state.recallIndex + 1) % recallPages().length;
    renderRecall();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  $('#recall-only-bad').addEventListener('click', () => { state.recallOnlyBad = !state.recallOnlyBad; state.recallIndex = 0; renderRecall(); });
  $('#recall-reset').addEventListener('click', () => {
    if (!confirm('清除所有「順／卡住」標記？')) return;
    state.recallMarks = {};
    store.set('recallMarks', {});
    renderRecall();
  });

  $('#memo-tts').addEventListener('click', toggleSpeak);
  $('#memo-listen').addEventListener('click', toggleListen);
  $('#memo-rate').value = String(store.get('memoRate', 1));
  $('#memo-rate').addEventListener('change', (event) => store.set('memoRate', Number(event.target.value)));
  $('#memo-pass').addEventListener('click', () => {
    const page = memoPage();
    markMemoPassed(page, state.memoLevel);
    if (state.memoLevel < LEVELS.length - 1) { state.memoLevel += 1; store.set('memoLevel', state.memoLevel); }
    renderMemo();
  });
  $('#memo-edit').addEventListener('click', () => openEditor(memoPage()));
  $('#read-edit').addEventListener('click', () => openEditor(visiblePages()[clampIndex(state.readIndex, visiblePages().length)]));
  $('#edit-save').addEventListener('click', saveEditor);
  $('#edit-restore').addEventListener('click', restoreEditor);
  $('#edit-cancel').addEventListener('click', () => $('#editor').close());
  $('#export-btn').addEventListener('click', exportEdits);
  $('#export-copy').addEventListener('click', () => { $('#export-text').select(); try { document.execCommand('copy'); } catch { /* user can copy manually */ } });
  $('#timer-start').addEventListener('click', startTimer);
  $('#timer-next').addEventListener('click', nextTimerPage);
  $('#timer-pause').addEventListener('click', togglePause);
  $('#timer-stop').addEventListener('click', () => { if (confirm('結束這次計時？')) finishTimer(); });

  $('#quiz-reveal').addEventListener('click', () => { $('#quiz-cover').hidden = true; $('#quiz-answer').hidden = false; });
  $$('[data-qmark]').forEach((button) => button.addEventListener('click', async () => {
    const item = state.data.qa[state.quizOrder[state.quizIndex]];
    state.quizMarks[item.id] = button.dataset.qmark;
    store.set('quizMarks', state.quizMarks);
    await stopActiveRecording();
    state.quizIndex = (state.quizIndex + 1) % state.quizOrder.length;
    renderQuiz();
  }));
  $('#quiz-next').addEventListener('click', async () => { await stopActiveRecording(); state.quizIndex = (state.quizIndex + 1) % state.quizOrder.length; renderQuiz(); });
  $('#quiz-shuffle').addEventListener('click', async () => { await stopActiveRecording(); reshuffleQuiz(); renderQuiz(); });

  $('#settings-btn').addEventListener('click', () => $('#settings').showModal());
  $('#fs').addEventListener('input', (event) => { store.set('fontSize', Number(event.target.value)); applyDisplay(); });
  $$('#theme button').forEach((button) => button.addEventListener('click', () => { store.set('theme', button.dataset.theme); applyDisplay(); }));
  $('#rec-clear').addEventListener('click', async () => {
    if (!confirm('刪除這支手機上所有練習錄音？')) return;
    try { await clearRecordings(); alert('已刪除所有錄音'); } catch (error) { alert(`刪除失敗：${error.message ?? error}`); }
    render();
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.closest('input, dialog')) return;
    if (state.view === 'timer' && state.timer && (event.key === ' ' || event.key === 'ArrowRight')) { event.preventDefault(); nextTimerPage(); }
    else if (event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowLeft') step(-1);
  });
}

async function init() {
  applyDisplay();
  try {
    const response = await fetch('data.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
  } catch (error) {
    document.querySelector('main').innerHTML = `<div class="card"><p class="q">讀不到逐字稿資料</p><p class="note">${escapeHtml(String(error.message ?? error))}。請連上網路後重新整理一次，之後就能離線使用。</p></div>`;
    return;
  }
  $('#data-note').textContent = `逐字稿來源：${state.data.source}`;
  bindEvents();
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((error) => console.warn('離線功能未啟用', error));
  }
}

init();
