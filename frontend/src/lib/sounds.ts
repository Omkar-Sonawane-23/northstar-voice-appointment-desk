type Tone = "ring" | "connect" | "end";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) return null;
  context ??= new AudioContextClass();
  if (context.state === "suspended") void context.resume();
  return context;
}

function blip(ctx: AudioContext, frequency: number, start: number, duration: number, gain: number) {
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(gain, start + 0.02);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(envelope).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export function playTone(tone: Tone): void {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.01;

  if (tone === "ring") {
    blip(ctx, 660, now, 0.12, 0.05);
    blip(ctx, 880, now + 0.18, 0.12, 0.05);
  } else if (tone === "connect") {
    blip(ctx, 520, now, 0.09, 0.04);
    blip(ctx, 780, now + 0.1, 0.16, 0.04);
  } else {
    blip(ctx, 440, now, 0.1, 0.035);
    blip(ctx, 300, now + 0.1, 0.16, 0.035);
  }
}

export function stopTone(): void {
  if (context && context.state === "running") void context.suspend();
}
