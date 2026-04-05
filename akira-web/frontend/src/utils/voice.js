/**
 * Voice conversation: speech-to-text (mic) and text-to-speech (Akira's reply).
 * Uses Web Speech API; works in desktop app when mic permission is granted.
 */

const SpeechRecognition =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

const speechSynthesis =
  typeof window !== 'undefined' && window.speechSynthesis;

/**
 * @returns {{ supported: boolean, recognition: boolean, synthesis: boolean }}
 */
export function useBrowserVoice() {
  return {
    supported: Boolean(SpeechRecognition && speechSynthesis),
    recognition: Boolean(SpeechRecognition),
    synthesis: Boolean(speechSynthesis),
  };
}

let recognitionInstance = null;

/**
 * Start listening for speech. Calls onResult with final transcript, onInterim with partial.
 * @param {{ onResult: (text: string) => void, onInterim?: (text: string) => void, onError?: (err: string) => void, lang?: string }} options
 * @returns {{ stop: () => void }}
 */
export function startListening({ onResult, onInterim, onError, lang = '' }) {
  if (!SpeechRecognition) {
    onError?.('Speech recognition not supported');
    return { stop: () => {} };
  }

  if (recognitionInstance) {
    try {
      try {
        recognitionInstance.abort();
      } catch (_) {
        recognitionInstance.stop();
      }
    } catch (_) {}
    recognitionInstance = null;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  if (lang) recognition.lang = lang;

  recognition.onresult = (event) => {
    let finalText = '';
    let interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = (result[0] && result[0].transcript) || '';
      if (result.isFinal) {
        finalText += text;
      } else {
        interimText += text;
      }
    }
    if (interimText) onInterim?.(interimText);
    if (finalText) onResult(finalText.trim());
  };

  recognition.onerror = (event) => {
    const msg = event.error === 'not-allowed' ? 'Microphone access denied' : event.error || 'Recognition error';
    onError?.(msg);
  };

  recognition.onend = () => {
    if (recognitionInstance === recognition) recognitionInstance = null;
  };

  try {
    recognition.start();
    recognitionInstance = recognition;
  } catch (e) {
    onError?.(e.message || 'Could not start listening');
  }

  return {
    stop: () => {
      try {
        if (recognitionInstance === recognition) {
          try {
            recognition.abort();
          } catch (_) {
            recognition.stop();
          }
          recognitionInstance = null;
        }
      } catch (_) {}
    },
  };
}

/**
 * Stop any active recognition.
 */
export function stopListening() {
  if (recognitionInstance) {
    try {
      try {
        recognitionInstance.abort();
      } catch (_) {
        recognitionInstance.stop();
      }
    } catch (_) {}
    recognitionInstance = null;
  }
}

/**
 * @returns {boolean}
 */
export function isListening() {
  return Boolean(recognitionInstance);
}

/** True while the browser is playing TTS (including between chained utterances). */
export function isSynthesizerSpeaking() {
  return Boolean(speechSynthesis && speechSynthesis.speaking);
}

// Prefer female voice names (browser- and OS-dependent).
const FEMALE_VOICE_NAMES = [
  'zira', 'samantha', 'victoria', 'karen', 'fiona', 'moira', 'tessa',
  'female', 'woman', 'google uk english female', 'google us english female',
  'microsoft zira', 'microsoft aria', 'alice', 'amanda', 'susan',
];

function getFemaleVoice() {
  const voices = speechSynthesis.getVoices();
  const match = voices.find((v) => {
    const name = (v.name || '').toLowerCase();
    return FEMALE_VOICE_NAMES.some((prefer) => name.includes(prefer));
  });
  return match || voices.find((v) => (v.name || '').toLowerCase().includes('female')) || voices[0];
}

/** Default TTS speed (1 = normal Web Speech baseline). Prior default 1.2, doubled. */
const DEFAULT_SPEECH_RATE = 2.4;

/** @type {Promise<void>} */
let speakQueueTail = Promise.resolve();

/** Bumped whenever queued speech should be abandoned (mic off, interrupt, new speak). */
let speakEpoch = 0;

/**
 * Drop queued (not-yet-started) utterances and invalidate pending speakQueued chains.
 * In-flight speech is unchanged until cancel/stopSpeaking.
 */
export function clearSpeakQueue() {
  speakQueueTail = Promise.resolve();
  speakEpoch += 1;
}

/**
 * Resolves when all queued utterances have finished (including any in flight from the queue).
 * @returns {Promise<void>}
 */
export function whenSpeakQueueIdle() {
  return speakQueueTail;
}

/**
 * One utterance without canceling the synthesis queue (for serialized streaming dictation).
 * @param {string} text
 * @param {{ rate?: number, pitch?: number, volume?: number, lang?: string }} options
 * @returns {Promise<void>}
 */
function speakOneWithoutCancel(text, { rate = DEFAULT_SPEECH_RATE, pitch = 1, volume = 1, lang = '' } = {}) {
  return new Promise((resolve, reject) => {
    if (!speechSynthesis) {
      reject(new Error('Speech synthesis not supported'));
      return;
    }
    // Filter out hashtags (e.g., #example) from the text before speaking
    const t = String(text || '').trim().replace(/#/g, '');
    if (!t) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(t);
    const voice = getFemaleVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;
    if (lang) utterance.lang = lang;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    speechSynthesis.speak(utterance);
  });
}

/**
 * Enqueue text to speak after prior queued utterances complete. Does not cancel current speech.
 * @param {string} text
 * @param {{ rate?: number, pitch?: number, volume?: number, lang?: string }} options
 * @returns {Promise<void>}
 */
export function speakQueued(text, options) {
  const scheduledEpoch = speakEpoch;
  const run = () => {
    if (scheduledEpoch !== speakEpoch) return Promise.resolve();
    return speakOneWithoutCancel(text, options);
  };
  const p = speakQueueTail.then(run, run);
  speakQueueTail = p.catch(() => {});
  return p;
}

/**
 * Speak text using the browser's speech synthesis. Returns a Promise that resolves when done.
 * Uses a female voice and a faster default rate (~2× the prior default).
 * Clears any speak queue first.
 * @param {string} text
 * @param {{ rate?: number, pitch?: number, volume?: number, lang?: string }} options
 * @returns {Promise<void>}
 */
export function speak(text, { rate = DEFAULT_SPEECH_RATE, pitch = 1, volume = 1, lang = '' } = {}) {
  return new Promise((resolve, reject) => {
    if (!speechSynthesis) {
      reject(new Error('Speech synthesis not supported'));
      return;
    }
    // Filter out hashtags (e.g., #example) from the text before speaking
    const t = String(text || '').trim().replace(/#/g, '');
    if (!t) {
      resolve();
      return;
    }

    clearSpeakQueue();
    if (speechSynthesis) speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(t);
    const voice = getFemaleVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;
    if (lang) utterance.lang = lang;
    utterance.onend = () => resolve();
    utterance.onerror = (e) => reject(e.error || new Error('Speech failed'));

    speechSynthesis.speak(utterance);
  });
}

/**
 * Stop any current speech and clear queued streaming utterances.
 */
export function stopSpeaking() {
  clearSpeakQueue();
  if (speechSynthesis) speechSynthesis.cancel();
}
