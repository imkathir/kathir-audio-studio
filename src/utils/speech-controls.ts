/**
 * Voice controls for the browser speech pipeline.
 *
 * Pure functions only (no DOM / Web Audio), so they can be unit-tested with Node.
 *
 *  - VoiceOptions: speed, pitch, pause length and a pronunciation dictionary.
 *  - Speech markup: `[pause:500]` / `[pause:0.5s]` for silences and `*word*` for emphasis.
 *  - Signal processing: pitch-preserving time stretch (WSOLA) and pitch shifting.
 */

export interface PronunciationEntry {
  from: string;
  to: string;
}

export interface VoiceOptions {
  /** Playback speed multiplier, 0.5 – 2.0. Pitch is preserved. */
  speed: number;
  /** Pitch shift in semitones, -6 – +6. Duration is preserved. */
  pitchSemitones: number;
  /** Multiplier applied to every pause, 0.5 – 2.0. */
  pauseScale: number;
  /** Words to respell before synthesis, e.g. "kathir = kah-theer". */
  pronunciations: PronunciationEntry[];
}

export const DEFAULT_VOICE_OPTIONS: VoiceOptions = {
  speed: 1,
  pitchSemitones: 0,
  pauseScale: 1,
  pronunciations: [],
};

export const SPEED_LIMITS = { min: 0.5, max: 2 } as const;
export const PITCH_LIMITS = { min: -6, max: 6 } as const;
export const PAUSE_LIMITS = { min: 0.5, max: 2 } as const;
export const MAX_PRONUNCIATION_ENTRIES = 50;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Clamp user-provided options into safe ranges. */
export function normalizeVoiceOptions(input?: Partial<VoiceOptions> | null): VoiceOptions {
  const merged = { ...DEFAULT_VOICE_OPTIONS, ...(input || {}) };
  const num = (value: unknown, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    speed: clamp(num(merged.speed, 1), SPEED_LIMITS.min, SPEED_LIMITS.max),
    pitchSemitones: clamp(num(merged.pitchSemitones, 0), PITCH_LIMITS.min, PITCH_LIMITS.max),
    pauseScale: clamp(num(merged.pauseScale, 1), PAUSE_LIMITS.min, PAUSE_LIMITS.max),
    pronunciations: (merged.pronunciations || []).slice(0, MAX_PRONUNCIATION_ENTRIES),
  };
}

/**
 * Parse a pronunciation dictionary written one entry per line:
 *   kathir = kah-theer
 * Blank lines and lines without both sides are ignored.
 */
export function parsePronunciationDictionary(raw: string): PronunciationEntry[] {
  const entries: PronunciationEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const from = line.slice(0, idx).trim();
    const to = line.slice(idx + 1).trim();
    if (!from || !to || from.length > 80 || to.length > 120) continue;
    entries.push({ from, to });
    if (entries.length >= MAX_PRONUNCIATION_ENTRIES) break;
  }
  return entries;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace whole-word matches (case-insensitive, Unicode-aware) with their spoken form.
 * Longer entries are applied first so "Kathir Studio" wins over "Kathir".
 */
export function applyPronunciations(text: string, entries: PronunciationEntry[]): string {
  if (!entries.length) return text;
  const ordered = [...entries].sort((a, b) => b.from.length - a.from.length);
  let result = text;
  for (const { from, to } of ordered) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(from)}(?![\\p{L}\\p{N}])`, 'giu');
    result = result.replace(pattern, () => to);
  }
  return result;
}

export type SpeechSegment =
  | { kind: 'text'; text: string; emphasis: boolean }
  | { kind: 'pause'; ms: number };

const PAUSE_TAG = /\[pause:\s*(\d+(?:\.\d+)?)\s*(ms|s)?\s*\]/gi;
const EMPHASIS_TAG = /\*([^*\n]+)\*/g;
export const MAX_PAUSE_MS = 5000;

/**
 * Split raw user text into plain text, emphasised text and explicit pauses.
 * Must run BEFORE sanitizeForSpeech, which strips asterisks and brackets.
 */
export function parseSpeechMarkup(input: string): SpeechSegment[] {
  const segments: SpeechSegment[] = [];

  const pushPlain = (text: string, emphasis: boolean) => {
    if (!text.trim()) return;
    segments.push({ kind: 'text', text, emphasis });
  };

  const pushTextWithEmphasis = (chunk: string) => {
    let cursor = 0;
    for (const match of chunk.matchAll(EMPHASIS_TAG)) {
      const start = match.index ?? 0;
      pushPlain(chunk.slice(cursor, start), false);
      pushPlain(match[1], true);
      cursor = start + match[0].length;
    }
    pushPlain(chunk.slice(cursor), false);
  };

  let cursor = 0;
  for (const match of input.matchAll(PAUSE_TAG)) {
    const start = match.index ?? 0;
    pushTextWithEmphasis(input.slice(cursor, start));
    const amount = parseFloat(match[1]);
    const ms = (match[2] || 'ms').toLowerCase() === 's' ? amount * 1000 : amount;
    segments.push({ kind: 'pause', ms: clamp(Math.round(ms), 0, MAX_PAUSE_MS) });
    cursor = start + match[0].length;
  }
  pushTextWithEmphasis(input.slice(cursor));
  return segments;
}

/* ------------------------------------------------------------------ */
/* Signal processing                                                  */
/* ------------------------------------------------------------------ */

export function silenceSamples(sampleRate: number, ms: number): Int16Array {
  return new Int16Array(Math.max(0, Math.round((sampleRate * ms) / 1000)));
}

/** Linear-interpolation resampler. Output length = input.length / factor. */
export function resampleLinear(input: Float32Array, factor: number): Float32Array {
  const outLength = Math.max(1, Math.round(input.length / factor));
  const out = new Float32Array(outLength);
  const last = input.length - 1;
  for (let i = 0; i < outLength; i++) {
    const pos = i * factor;
    const i0 = Math.min(last, Math.floor(pos));
    const i1 = Math.min(last, i0 + 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/**
 * WSOLA (waveform-similarity overlap-add) time stretch.
 * timeScale > 1 makes the audio longer (slower), < 1 makes it shorter (faster).
 * Pitch is preserved because grains are copied, not resampled.
 */
export function wsolaStretch(input: Float32Array, timeScale: number): Float32Array {
  const FRAME = 1024;
  const HOP = FRAME >> 1;
  const TOLERANCE = 96;
  if (Math.abs(timeScale - 1) < 1e-3 || input.length < FRAME * 2) {
    return input.slice();
  }

  const outLength = Math.max(1, Math.round(input.length * timeScale));
  const out = new Float32Array(outLength + FRAME);
  const norm = new Float32Array(outLength + FRAME);

  const win = new Float32Array(FRAME);
  for (let k = 0; k < FRAME; k++) win[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (FRAME - 1));

  const overlapAdd = (start: number, outPos: number) => {
    for (let k = 0; k < FRAME; k++) {
      out[outPos + k] += input[start + k] * win[k];
      norm[outPos + k] += win[k] * win[k];
    }
  };

  // First grain
  overlapAdd(0, 0);
  let prevStart = 0;

  for (let outPos = HOP; outPos + FRAME <= outLength; outPos += HOP) {
    const nominal = Math.round(outPos / timeScale);
    const natural = prevStart + HOP; // where the previous grain would naturally continue
    let bestStart = clamp(nominal, 0, input.length - FRAME);

    if (natural + FRAME <= input.length) {
      let bestCorr = -Infinity;
      for (let delta = -TOLERANCE; delta <= TOLERANCE; delta += 2) {
        const cand = nominal + delta;
        if (cand < 0 || cand + FRAME > input.length) continue;
        let corr = 0;
        for (let k = 0; k < FRAME; k += 2) {
          corr += input[cand + k] * input[natural + k];
        }
        if (corr > bestCorr) {
          bestCorr = corr;
          bestStart = cand;
        }
      }
    }

    overlapAdd(bestStart, outPos);
    prevStart = bestStart;
  }

  const result = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    result[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
  }
  return result;
}

export interface ChunkShape {
  speed: number;
  pitchSemitones: number;
  gain: number;
}

/**
 * Apply speed, pitch and gain to one synthesised chunk.
 * Pitch shift = resample, then stretch back to the original duration.
 */
export function shapeSamples(samples: Int16Array, shape: ChunkShape): Int16Array {
  const speed = shape.speed || 1;
  const pitch = shape.pitchSemitones || 0;
  const gain = shape.gain || 1;
  const needsSpeed = Math.abs(speed - 1) > 1e-3;
  const needsPitch = Math.abs(pitch) > 0.01;
  const needsGain = Math.abs(gain - 1) > 1e-3;
  if (!needsSpeed && !needsPitch && !needsGain) return samples;

  let x: Float32Array = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) x[i] = samples[i] / 32768;

  if (needsPitch) {
    const factor = Math.pow(2, pitch / 12);
    x = resampleLinear(x, factor);
    x = wsolaStretch(x, factor);
  }
  if (needsSpeed) {
    x = wsolaStretch(x, 1 / speed);
  }

  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i] * gain));
    out[i] = Math.round(v * 32767);
  }
  return out;
}
