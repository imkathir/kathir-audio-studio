/**
 * Interaction test: switching the language / voice model must never discard
 * text the user wrote.
 *
 * Run with:  npx tsx scripts/test-voice-switch.ts
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://example.test/',
  pretendToBeVisual: true,
});

const g: any = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
g.navigator = dom.window.navigator;
g.HTMLElement = dom.window.HTMLElement;
g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
g.HTMLSelectElement = dom.window.HTMLSelectElement;
g.Event = dom.window.Event;
g.MouseEvent = dom.window.MouseEvent;
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
const { act } = React as any;
const { createRoot } = await import('react-dom/client');
const { AudioInputPanel } = await import('../src/components/AudioInputPanel');

const container = dom.window.document.getElementById('root')!;
const root = createRoot(container);

await act(async () => {
  root.render(
    React.createElement(AudioInputPanel, {
      onConvert: () => {},
      isConverting: false,
      conversionProgress: '',
    })
  );
});

const doc = dom.window.document as unknown as Document;
const textarea = () => doc.querySelector('#tts-text') as HTMLTextAreaElement;
const voiceSelect = () => doc.querySelector('#voice-select') as HTMLSelectElement;
const buttonByText = (label: string): Element => {
  const found = Array.from(doc.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(label)
  );
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
};

function typeText(value: string) {
  const el = textarea();
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

function selectOption(el: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
const check = (name: string, pass: boolean, detail = '') => results.push({ name, pass, detail });
const click = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
};

// --- 1. pristine state -> a preset swaps in its sample text ---------------------
await click(buttonByText('English Male'));
check(
  'pristine: preset loads its sample text',
  textarea().value.startsWith('Welcome to kathirStudio - Universal Text to Audio Format Converter.'),
  textarea().value.slice(0, 55)
);

// --- 2. the user writes their own text -----------------------------------------
const myText = 'My own carefully written narration about the history of coffee.';
await act(async () => {
  typeText(myText);
});
check('user text typed', textarea().value === myText);

// --- 3. (default: the stable female model is selected, testing ones hidden)
// --- 3. the user picks a female model, then a custom one (Zephyr) --------------
await click(buttonByText('👩Female'));
// testing voices are hidden by default; reveal them before picking one
await act(async () => {
  const toggle = Array.from(doc.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').startsWith('Show testing voices')
  );
  toggle?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
});
await act(async () => {
  selectOption(voiceSelect(), 'Zephyr');
});
check('custom female model selected', voiceSelect().value === 'Zephyr', `voice: ${voiceSelect().value}`);

// --- 4. switching the language + model via a preset keeps the text --------------
await click(buttonByText('தமிழ் ஆண்'));
check(
  'preset switch keeps the user text',
  textarea().value === myText,
  `got: "${textarea().value.slice(0, 45)}"`
);
check('preset switched the model to the male one', voiceSelect().value === 'Charon', `voice: ${voiceSelect().value}`);

// --- 5. switching the voice character keeps the text ---------------------------
await click(buttonByText('👨Male'));
check('gender toggle keeps the user text', textarea().value === myText);

// --- 6. flipping back to female restores the voice picked earlier ---------------
await click(buttonByText('👩Female'));
check(
  'switching back to female restores the previously picked model',
  voiceSelect().value === 'Zephyr',
  `voice: ${voiceSelect().value}`
);
check('text still intact after every switch', textarea().value === myText);

// --- 7. the voice dropdown never touches the text -------------------------------
await act(async () => {
  selectOption(voiceSelect(), 'Kore');
});
check('voice dropdown keeps the user text', textarea().value === myText);

// --- 8. the notice explains what happened --------------------------------------
const notice = Array.from(doc.querySelectorAll('div')).some((d) =>
  (d as HTMLElement).textContent?.includes('Your text was kept')
);
check('notice explains that the text was kept', notice);

console.log('\n=== voice switch interaction test ===');
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
