/**
 * Unit checks for the voice controls: dictionary, markup, options and DSP.
 * Run with: npm run test:audio
 */
import {
  applyPronunciations,
  normalizeVoiceOptions,
  parsePronunciationDictionary,
  parseSpeechMarkup,
  shapeSamples,
  wsolaStretch,
  resampleLinear,
} from '../src/utils/speech-controls';
import { buildChunkSpecs } from '../src/utils/client-tts';

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
const check = (name: string, pass: boolean, detail = '') => results.push({ name, pass, detail });

const RATE = 22050;

/** Estimate the dominant frequency by counting upward zero crossings. */
function frequencyOf(samples: Float32Array | Int16Array, rate: number): number {
  let crossings = 0;
  let first = -1;
  let last = -1;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) {
      crossings++;
      if (first < 0) first = i;
      last = i;
    }
  }
  if (crossings < 2) return 0;
  return ((crossings - 1) * rate) / (last - first);
}

function tone(freq: number, seconds: number): Int16Array {
  const n = Math.round(RATE * seconds);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / RATE) * 12000);
  return out;
}

// --- dictionary -------------------------------------------------------------
const dict = parsePronunciationDictionary('kathir = kah-theer\n\nbad line\n= nothing\nTamil=Tamil(ta)');
check('dictionary keeps valid lines only', dict.length === 2, JSON.stringify(dict));
check(
  'pronunciation replaces whole words only',
  applyPronunciations('Kathir and Kathirvel', [{ from: 'Kathir', to: 'kah-theer' }]) === 'kah-theer and Kathirvel'
);
check(
  'longer entry wins over its prefix',
  applyPronunciations('Kathir Studio', [
    { from: 'Kathir', to: 'K1' },
    { from: 'Kathir Studio', to: 'K2' },
  ]) === 'K2'
);

// --- markup -----------------------------------------------------------------
const segs = parseSpeechMarkup('Hello *world* now. [pause:500] Bye [pause:0.25s].');
const kinds = segs.map((s) => (s.kind === 'pause' ? `pause${s.ms}` : `${s.emphasis ? 'em' : 'tx'}`)).join(',');
check('markup yields text, emphasis and pauses', kinds === 'tx,em,tx,pause500,tx,pause250,tx', kinds);
check('markup removes tag characters from text', segs.every((s) => s.kind === 'pause' || !/\[|\]|\*/.test(s.text)));
check('pause is clamped to 5 s', parseSpeechMarkup('[pause:99999]')[0].kind === 'pause' && (parseSpeechMarkup('[pause:99999]')[0] as any).ms === 5000);

// --- options ----------------------------------------------------------------
const opts = normalizeVoiceOptions({ speed: 9, pitchSemitones: -40, pauseScale: 0 });
check('options are clamped to safe ranges', opts.speed === 2 && opts.pitchSemitones === -6 && opts.pauseScale === 0.5, JSON.stringify(opts));

// --- DSP --------------------------------------------------------------------
const base = tone(220, 1.0);
const slow = wsolaStretch(Float32Array.from(base, (v) => v / 32768), 1.5);
check(
  'time stretch lengthens by the requested factor',
  Math.abs(slow.length / base.length - 1.5) < 0.02,
  `ratio ${(slow.length / base.length).toFixed(3)}`
);
const slowFreq = frequencyOf(slow, RATE);
check('time stretch keeps pitch (220 Hz)', Math.abs(slowFreq - 220) < 6, `${slowFreq.toFixed(1)} Hz`);

const fast = shapeSamples(base, { speed: 1.5, pitchSemitones: 0, gain: 1 });
check(
  'speed 1.5x shortens audio to about 2/3',
  Math.abs(fast.length / base.length - 1 / 1.5) < 0.02,
  `ratio ${(fast.length / base.length).toFixed(3)}`
);
check('speed 1.5x keeps pitch (220 Hz)', Math.abs(frequencyOf(fast, RATE) - 220) < 6, `${frequencyOf(fast, RATE).toFixed(1)} Hz`);

const up = shapeSamples(base, { speed: 1, pitchSemitones: 12, gain: 1 });
const upFreq = frequencyOf(up, RATE);
check('+12 semitones doubles pitch (440 Hz)', Math.abs(upFreq - 440) < 12, `${upFreq.toFixed(1)} Hz`);
check(
  '+12 semitones keeps duration',
  Math.abs(up.length / base.length - 1) < 0.03,
  `ratio ${(up.length / base.length).toFixed(3)}`
);

const down = shapeSamples(base, { speed: 1, pitchSemitones: -12, gain: 1 });
check('-12 semitones halves pitch (110 Hz)', Math.abs(frequencyOf(down, RATE) - 110) < 6, `${frequencyOf(down, RATE).toFixed(1)} Hz`);

const identity = shapeSamples(base, { speed: 1, pitchSemitones: 0, gain: 1 });
check('default shape returns the same samples untouched', identity === base);

const resampled = resampleLinear(Float32Array.from(base, (v) => v / 32768), 2);
check('resampler halves length for factor 2', Math.abs(resampled.length - base.length / 2) <= 1);

// --- chunk planning ----------------------------------------------------------
const planned = buildChunkSpecs('[pause:300] Welcome to *kathir studio*. Kathir is here. [pause:1s] Thank you.', [
  { from: 'Kathir', to: 'kah theer' },
]);
check('leading pause is attached to the first chunk', planned[0].leadingPauseMs === 300, `${planned[0].leadingPauseMs}`);
check(
  'emphasis becomes its own chunk, with its full stop kept',
  planned[1].emphasis === true && planned[1].text === 'kah theer studio.',
  JSON.stringify(planned[1])
);
check('mid-sentence join has no sentence gap', planned[0].softBreak === true && planned[0].text === 'Welcome to');
check('pronunciation applies inside chunks', planned[2].text.startsWith('kah theer is here'), planned[2].text);
check('[pause:1s] after a sentence adds 1000 ms', planned[2].extraPauseMs === 1000, `${planned[2].extraPauseMs}`);
const empty = buildChunkSpecs('');
check('empty input still yields one chunk', empty.length === 1 && empty[0].text.length > 0);

// --- report -----------------------------------------------------------------
console.log('\n=== audio controls unit checks ===');
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
