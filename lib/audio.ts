// Web Audio API — no external files needed

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)();
  }
  return audioCtx;
}

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = "sine",
  gain = 0.3,
  startDelay = 0
): Promise<void> {
  return new Promise((resolve) => {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime + startDelay);

    gainNode.gain.setValueAtTime(0, ctx.currentTime + startDelay);
    gainNode.gain.linearRampToValueAtTime(
      gain,
      ctx.currentTime + startDelay + 0.01
    );
    gainNode.gain.linearRampToValueAtTime(
      0,
      ctx.currentTime + startDelay + duration / 1000
    );

    oscillator.start(ctx.currentTime + startDelay);
    oscillator.stop(ctx.currentTime + startDelay + duration / 1000 + 0.01);

    oscillator.onended = () => resolve();
  });
}

/** Ascending double-beep — scan success */
export async function playSuccess() {
  try {
    await playTone(880, 120, "sine", 0.3, 0);
    await playTone(1320, 160, "sine", 0.25, 0.14);
  } catch {
    // Silently ignore — some browsers block AudioContext without interaction
  }
}

/** Low buzz — duplicate or scan failure */
export async function playFailed() {
  try {
    // Two descending tones
    await playTone(330, 200, "sawtooth", 0.25, 0);
    await playTone(220, 300, "sawtooth", 0.2, 0.22);
  } catch {
    // Silently ignore
  }
}

/** Short click — UI interaction */
export async function playClick() {
  try {
    await playTone(660, 60, "square", 0.1, 0);
  } catch {
    // Silently ignore
  }
}
