// 播放引擎（Web Speech API）
// 規則：同一時間只有一個 utterance；切換狀態前一定先 cancel 並清除計時器；
// 所有非同步回呼都用 runId 檢查是否已經過期。

// 語速選項（播放列上由左到右）。1.0 是語音本身的正常速度
export const RATES = [1.15, 1.0, 0.9, 0.7];
export const DEFAULT_RATE = 1.0;

export function formatRate(rate) {
  return Number.isInteger(rate) ? rate.toFixed(1) : String(rate);
}

const ALL_GAP_MS = 300;        // 整篇播放時句子之間的停頓
const KEEPALIVE_MS = 10000;    // Chrome 桌機版唸超過約 15 秒會自己停，長句子定期 pause/resume
const KEEPALIVE_MIN_CHARS = 150;

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
export const speechSupported = !!synth && typeof SpeechSynthesisUtterance !== 'undefined';
const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

function voiceScore(v) {
  let score = 0;
  if (/^de[-_]DE/i.test(v.lang)) score += 2;
  if (/natural|neural|online|enhanced|premium|google/i.test(v.name)) score += 3;
  return score;
}

export function getGermanVoices() {
  if (!speechSupported) return [];
  return synth.getVoices()
    .filter((v) => /^de([-_]|$)/i.test(v.lang))
    .sort((a, b) => voiceScore(b) - voiceScore(a));
}

// 語音清單是非同步載入的
export function onVoicesChanged(callback) {
  if (!speechSupported) return () => {};
  synth.addEventListener('voiceschanged', callback);
  return () => synth.removeEventListener('voiceschanged', callback);
}

export function pickVoice(voiceURI) {
  const voices = getGermanVoices();
  return voices.find((v) => v.voiceURI === voiceURI) || voices[0] || null;
}

function makeUtterance(text, voiceURI, rate) {
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(voiceURI);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else {
    u.lang = 'de-DE';
  }
  u.rate = rate;
  return u;
}

function errorMessage(code) {
  if (code === 'not-allowed') return '瀏覽器擋下了播放，請再按一次播放。';
  if (code === 'network' || code === 'synthesis-unavailable' || code === 'voice-unavailable') {
    return '這個語音目前無法使用（可能需要網路），請到設定換一個語音。';
  }
  return `播放失敗（${code}）`;
}

// 設定頁試聽用：唸一次就結束
export function speakOnce(text, { voiceURI, rate }) {
  if (!speechSupported) return;
  synth.cancel();
  synth.speak(makeUtterance(text, voiceURI, rate));
}

export function cancelSpeech() {
  if (speechSupported) synth.cancel();
}

// state: { mode: 'idle' | 'loop' | 'all', index, phase: 'idle' | 'speaking' | 'pause', error }
export function createPlayer({ sentences, settings, startIndex = 0, onChange }) {
  let mode = 'idle';
  let phase = 'idle';
  let index = startIndex;
  let error = null;
  let runId = 0;
  let timer = null;
  let keepAlive = null;
  let utterance = null; // 保留參照，避免 Chrome 回收 utterance 後 onend 不觸發
  let resumeState = null;

  const state = () => ({ mode, index, phase, error });
  const emit = () => onChange(state());
  const rate = () => (RATES.includes(settings.rate) ? settings.rate : DEFAULT_RATE);

  function hardStop() {
    runId++;
    clearTimeout(timer);
    clearInterval(keepAlive);
    timer = keepAlive = null;
    utterance = null;
    cancelSpeech();
  }

  function say(text, onEnd) {
    const id = runId;
    const u = makeUtterance(text, settings.voiceURI, rate());
    u.onend = () => {
      if (id !== runId) return;
      clearInterval(keepAlive);
      onEnd();
    };
    u.onerror = (e) => {
      if (id !== runId || e.error === 'interrupted' || e.error === 'canceled') return;
      hardStop();
      mode = 'idle';
      phase = 'idle';
      error = errorMessage(e.error);
      emit();
    };
    utterance = u;
    synth.speak(u);
    // Android 的 pause/resume 不可靠，不套用
    if (text.length > KEEPALIVE_MIN_CHARS && !isAndroid) {
      keepAlive = setInterval(() => {
        if (synth.speaking && !synth.paused) {
          synth.pause();
          synth.resume();
        }
      }, KEEPALIVE_MS);
    }
  }

  // 依照目前的 mode 從 index 這句的開頭開始唸
  function run() {
    hardStop();
    error = null;
    phase = 'speaking';
    emit();
    say(sentences[index].de, () => {
      if (mode === 'loop') {
        phase = 'pause';
        emit();
        timer = setTimeout(run, settings.pauseMs);
      } else if (mode === 'all' && index < sentences.length - 1) {
        phase = 'pause';
        emit();
        timer = setTimeout(() => { index++; run(); }, ALL_GAP_MS);
      } else {
        mode = 'idle';
        phase = 'idle';
        emit();
      }
    });
  }

  function start(newMode, i) {
    if (!speechSupported) return;
    index = clamp(i);
    mode = newMode;
    resumeState = null;
    run();
  }

  function clamp(i) {
    return Math.max(0, Math.min(sentences.length - 1, i));
  }

  return {
    get state() { return state(); },

    loop(i = index) { start('loop', i); },
    playAll(i = index) { start('all', i); },

    stop() {
      hardStop();
      mode = 'idle';
      phase = 'idle';
      resumeState = null;
      emit();
    },

    // 換句子時維持目前的模式；沒在播放就只是選取
    goTo(i) {
      const target = clamp(i);
      if (target === index && mode === 'idle') return;
      index = target;
      if (mode !== 'idle') run();
      else emit();
    },
    next() { this.goTo(index + 1); },
    prev() { this.goTo(index - 1); },

    // 換語速：播放中就從這句開頭用新語速重唸
    speedChanged() {
      if (mode !== 'idle') run();
      else emit();
    },

    // 點單字：中斷目前的播放，唸單字；之後呼叫 resume() 回到原本的狀態
    speakWord(word) {
      if (!speechSupported) return;
      if (mode !== 'idle') resumeState = { mode, index };
      hardStop();
      mode = 'idle';
      phase = 'idle';
      emit();
      say(word, () => {});
    },
    resume() {
      if (!resumeState) return;
      ({ mode, index } = resumeState);
      resumeState = null;
      run();
    },

    destroy() {
      hardStop();
      mode = 'idle';
    },
  };
}
