/**
 * Play a short completion sound when Akira finishes a response.
 * Warm, low, subtle — like a soft chime.
 */
export function playCompletionSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    // Soft low note (G4) + gentle fifth above for a refined two-note chime
    const playNote = (freq, start, duration, vol) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(vol, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.start(start);
      osc.stop(start + duration);
    };

    playNote(392, now, 0.22, 0.06);           // G4
    playNote(523.25, now + 0.04, 0.18, 0.04); // C5, slightly delayed
  } catch (_) {
    // Ignore if AudioContext is not supported or blocked (e.g. autoplay policy)
  }
}
