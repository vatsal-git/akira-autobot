/**
 * Incrementally extract assistant-visible text (outside <details>...</details>) from streamed
 * deltas and enqueue sentence- or size-bounded chunks for TTS.
 */

const OPEN_TAG = '<details';
const CLOSE_TAG = '</details>';

/**
 * Longest suffix of `str` that equals the first k chars of `tag` (ASCII case-insensitive), k < tag.length.
 * Used to avoid splitting a tag across deltas.
 * @param {string} str
 * @param {string} tag
 * @returns {string}
 */
function longestOpenTagPrefixSuffix(str, tag) {
  const sl = str.toLowerCase();
  const tl = tag.toLowerCase();
  const n = Math.min(str.length, tag.length - 1);
  for (let k = n; k >= 1; k--) {
    if (sl.slice(-k) === tl.slice(0, k)) return str.slice(-k);
  }
  return '';
}

/**
 * @param {{ enqueueSpeak: (chunk: string) => void, maxChunk?: number }} options
 */
export function createStreamDictation({ enqueueSpeak, maxChunk = 100 }) {
  let inDetails = false;
  /** Incomplete tag carried to the next delta */
  let pending = '';
  /** Outside-details text waiting for a flush boundary */
  let speechBuffer = '';

  function flushBuffer(force) {
    while (speechBuffer.length) {
      let cut = -1;
      if (!force) {
        for (let i = 0; i < speechBuffer.length; i++) {
          const c = speechBuffer[i];
          if (c === '\n') {
            cut = i + 1;
            break;
          }
          if (
            (c === '.' || c === '?' || c === '!') &&
            i + 1 < speechBuffer.length &&
            /\s/.test(speechBuffer[i + 1])
          ) {
            cut = i + 2;
            break;
          }
        }
        if (cut === -1 && speechBuffer.length < maxChunk) return;
        if (cut === -1) {
          const sp = speechBuffer.lastIndexOf(' ', maxChunk);
          cut = sp > 0 ? sp + 1 : Math.min(maxChunk, speechBuffer.length);
        }
      } else {
        cut = speechBuffer.length;
      }
      const part = speechBuffer.slice(0, cut).trim();
      speechBuffer = speechBuffer.slice(cut);
      if (part) enqueueSpeak(part);
    }
  }

  /**
   * @param {string} [delta]
   */
  function pushDelta(delta) {
    let chunk = pending + (delta ?? '');
    pending = '';

    while (chunk.length) {
      if (!inDetails) {
        const lower = chunk.toLowerCase();
        const openAt = lower.indexOf(OPEN_TAG);
        if (openAt === -1) {
          const hold = longestOpenTagPrefixSuffix(chunk, OPEN_TAG);
          const safeLen = chunk.length - hold.length;
          if (safeLen > 0) {
            speechBuffer += chunk.slice(0, safeLen);
            flushBuffer(false);
          }
          pending = hold;
          chunk = '';
        } else {
          if (openAt > 0) {
            speechBuffer += chunk.slice(0, openAt);
            flushBuffer(false);
          }
          chunk = chunk.slice(openAt + OPEN_TAG.length);
          inDetails = true;
        }
      } else {
        const lower = chunk.toLowerCase();
        const closeAt = lower.indexOf(CLOSE_TAG);
        if (closeAt === -1) {
          pending = longestOpenTagPrefixSuffix(chunk, CLOSE_TAG);
          chunk = '';
        } else {
          chunk = chunk.slice(closeAt + CLOSE_TAG.length);
          inDetails = false;
          pending = '';
        }
      }
    }
  }

  /** Flush remaining speakable text (call when the SSE stream ends). */
  function finish() {
    if (!inDetails) {
      pending = '';
    } else {
      pending = '';
    }
    flushBuffer(true);
    inDetails = false;
    pending = '';
    speechBuffer = '';
  }

  function reset() {
    inDetails = false;
    pending = '';
    speechBuffer = '';
  }

  return { pushDelta, finish, reset };
}
