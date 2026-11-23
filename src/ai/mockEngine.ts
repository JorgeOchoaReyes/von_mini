/**
 * Development-only mock engine.
 *
 * Enabled only when `EXPO_PUBLIC_MOCK_ENGINE=true` **and** the bundle is a development build, so
 * it can never be reached in a release build. It exists so the build/edit/undo flows can be
 * exercised on a machine that has no Gemini Nano (for example CI, or a Linux VM used to take
 * screenshots for the submission). It answers with the same shapes the real engine returns.
 */
import type { AIEngine, DeviceStatus, GenerateChunk, GenerateOptions, GenerateResult } from './types';

export const mockEnabled = __DEV__ && process.env.EXPO_PUBLIC_MOCK_ENGINE === 'true';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Canned specs so the mock produces believable apps for the demo flows. */
const LIBRARY: { match: RegExp; json: string }[] = [
  {
    match: /water|hydrat|drink/i,
    json: `{"name":"Water Tracker","emoji":"💧","accent":"blue","description":"Log every glass and get a nudge when you fall behind.","components":[
      {"type":"choice","id":"amount","label":"How much did you drink?","options":["A glass","A bottle","A lot"]},
      {"type":"input","id":"note","label":"How do you feel?","placeholder":"A bit tired","multiline":true},
      {"type":"ai","id":"nudge","label":"Nudge me","prompt":"I just logged {amount} of water and I feel like this: {note}. In two short sentences, encourage me kindly."},
      {"type":"save","label":"Log it"},{"type":"history","label":"Today"}]}`,
  },
  {
    match: /mood|journal|diary|feel/i,
    json: `{"name":"Mood Journal","emoji":"😊","accent":"violet","description":"Write about your day and get a private mood tag.","components":[
      {"type":"input","id":"entry","label":"How was your day?","placeholder":"Write freely…","multiline":true},
      {"type":"ai","id":"mood","label":"Tag my mood","prompt":"Read this journal entry and reply with one emoji and one word for the mood: {entry}"},
      {"type":"ai","id":"reflection","label":"Reflect","prompt":"In two gentle sentences, reflect back what this person is feeling and suggest one small kind action: {entry}"},
      {"type":"save","label":"Save entry"},{"type":"history","label":"Past entries"}]}`,
  },
  {
    match: /habit|streak|routine|daily/i,
    json: `{"name":"Habit Tracker","emoji":"🔁","accent":"green","description":"Log a habit and get a weekly reflection.","components":[
      {"type":"input","id":"habit","label":"Which habit?","placeholder":"Morning walk"},
      {"type":"choice","id":"done","label":"Did you do it?","options":["Yes","Partly","Not today"]},
      {"type":"ai","id":"reflect","label":"Reflect on my week","prompt":"The habit is {habit} and today I did it: {done}. In two short sentences, encourage me and suggest one small adjustment."},
      {"type":"save","label":"Log today"},{"type":"history","label":"Recent logs"}]}`,
  },
  {
    match: /rewrit|tone|message|email|reply/i,
    json: `{"name":"Tone Fixer","emoji":"✉️","accent":"blue","description":"Paste a message and rewrite it in the tone you need.","components":[
      {"type":"input","id":"message","label":"Your message","placeholder":"Paste an email or text…","multiline":true},
      {"type":"choice","id":"tone","label":"Tone","options":["Friendly","Professional","Shorter","Apologetic"]},
      {"type":"ai","id":"rewrite","label":"Rewrite","prompt":"Rewrite this message in a {tone} tone. Keep the meaning. Reply with only the rewritten message: {message}"},
      {"type":"save","label":"Save"},{"type":"history","label":"Saved rewrites"}]}`,
  },
  {
    match: /expense|spend|money|budget|receipt/i,
    json: `{"name":"Expense Notes","emoji":"💸","accent":"amber","description":"Note what you spent and see where the money went.","components":[
      {"type":"input","id":"item","label":"What did you buy?","placeholder":"Coffee and a sandwich"},
      {"type":"input","id":"amount","label":"How much?","placeholder":"12.50"},
      {"type":"choice","id":"category","label":"Category","options":["Food","Transport","Home","Fun","Health"]},
      {"type":"ai","id":"tip","label":"Money tip","prompt":"I spent {amount} on {item} ({category}). In one short sentence, give me a practical money tip."},
      {"type":"save","label":"Add expense"},{"type":"history","label":"This week"}]}`,
  },
  {
    match: /flashcard|study|quiz|memor|exam/i,
    json: `{"name":"Flashcards","emoji":"🧠","accent":"teal","description":"Paste study notes and get quiz questions.","components":[
      {"type":"input","id":"topic","label":"Topic","placeholder":"Cell biology"},
      {"type":"input","id":"notes","label":"Study notes","placeholder":"Paste your notes…","multiline":true},
      {"type":"ai","id":"cards","label":"Make flashcards","prompt":"Write 4 flashcards from these notes about {topic}. Format each as \\"Q: ...\\" then \\"A: ...\\" on the next line: {notes}"},
      {"type":"save","label":"Save deck"},{"type":"history","label":"Saved decks"}]}`,
  },
  {
    match: /meeting|notes|summar|action item|standup/i,
    json: `{"name":"Meeting Notes","emoji":"📝","accent":"violet","description":"Turn rough notes into a summary and a to-do list.","components":[
      {"type":"input","id":"title","label":"Meeting","placeholder":"Weekly sync"},
      {"type":"input","id":"notes","label":"Rough notes","placeholder":"Paste or type notes…","multiline":true},
      {"type":"ai","id":"summary","label":"Summarize","prompt":"Summarize these meeting notes in two sentences: {notes}"},
      {"type":"ai","id":"actions","label":"Action items","prompt":"List the action items from these notes as short bullet points starting with \\"- \\". Include the owner if mentioned: {notes}"},
      {"type":"save","label":"Save meeting"},{"type":"history","label":"Past meetings"}]}`,
  },
  {
    match: /recipe|cook|fridge|meal|ingredient/i,
    json: `{"name":"Recipe Scaler","emoji":"🍳","accent":"rose","description":"Scale a recipe and get ideas from what you have.","components":[
      {"type":"input","id":"recipe","label":"Recipe or ingredients","placeholder":"Pancakes for 4","multiline":true},
      {"type":"choice","id":"servings","label":"How many servings?","options":["1","2","4","6","8"]},
      {"type":"ai","id":"scale","label":"Scale it","prompt":"Scale this recipe to {servings} servings and list the ingredients with amounts, one per line starting with \\"- \\": {recipe}"},
      {"type":"save","label":"Save recipe"},{"type":"history","label":"Saved recipes"}]}`,
  },
  {
    match: /workout|gym|train|exercise|run|fit/i,
    json: `{"name":"Workout Log","emoji":"🏋️","accent":"green","description":"Log a session and get a suggestion for next time.","components":[
      {"type":"input","id":"session","label":"What did you do?","placeholder":"5k run, squats"},
      {"type":"choice","id":"effort","label":"How hard was it?","options":["Easy","Just right","Hard"]},
      {"type":"ai","id":"next","label":"What next?","prompt":"I did {session} and it felt {effort}. Suggest one short workout for next time, in two sentences."},
      {"type":"save","label":"Log workout"},{"type":"history","label":"Past sessions"}]}`,
  },
];

const FALLBACK = `{"name":"Quick Notes","emoji":"✨","accent":"violet","description":"Capture a thought and get a little help with it.","components":[
  {"type":"input","id":"note","label":"What's on your mind?","placeholder":"Type anything…","multiline":true},
  {"type":"ai","id":"help","label":"Help me","prompt":"Read this note and reply with two short, useful sentences: {note}"},
  {"type":"save","label":"Save"},{"type":"history","label":"Saved notes"}]}`;

/** Very small keyword-driven edit so the mock can also demonstrate the edit + diff + undo flow. */
function editSpec(currentJson: string, change: string): string {
  let spec: { components: Record<string, unknown>[] };
  try {
    spec = JSON.parse(currentJson);
  } catch {
    return FALLBACK;
  }
  const c = change.toLowerCase();
  const has = (id: string) => spec.components.some((x) => x.id === id);
  const addField = (id: string, label: string, multiline = false) => {
    if (has(id)) return;
    const at = spec.components.findIndex((x) => x.type === 'ai');
    const field = { type: 'input', id, label, multiline, placeholder: '…' };
    spec.components.splice(at < 0 ? spec.components.length - 2 : at, 0, field);
  };

  if (/date|when|day/.test(c)) addField('date', 'Date');
  if (/time|hour/.test(c)) addField('hours', 'How long?');
  if (/mood|feel/.test(c)) addField('mood_note', 'How do you feel?');
  if (/note|comment|detail/.test(c)) addField('notes', 'Extra notes', true);
  if (/sleep/.test(c)) addField('sleep', 'How did you sleep?');
  if (/name/.test(c)) addField('name', 'Name');
  if (/shorter|concise|brief/.test(c)) {
    for (const x of spec.components) {
      if (x.type === 'ai' && typeof x.prompt === 'string' && !/at most|short|sentence/.test(x.prompt)) {
        x.prompt = `${x.prompt} Keep the answer to two short sentences.`;
      }
    }
  }
  if (/remove|delete|drop/.test(c)) {
    const m = c.match(/(?:remove|delete|drop)\s+(?:the\s+)?["“]?([a-z ]+)["”]?/);
    if (m) {
      const words = m[1].trim().split(/\s+/);
      const i = spec.components.findIndex(
        (x) =>
          typeof x.label === 'string' &&
          words.some((w) => w.length > 3 && (x.label as string).toLowerCase().includes(w)),
      );
      if (i >= 0) spec.components.splice(i, 1);
    }
  }
  if (/rename|call it/.test(c)) {
    const m = change.match(/["“']([^"”']{2,30})["”']/);
    if (m) (spec as unknown as { name: string }).name = m[1];
  }
  return JSON.stringify(spec);
}

const EDIT_PREFIX = 'Current app JSON:';

export const mockEngine: AIEngine = {
  runtime: 'none',
  streaming: true,

  async status(): Promise<DeviceStatus> {
    return 'available';
  },

  async download(): Promise<DeviceStatus> {
    await sleep(120);
    return 'available';
  },

  async generate(prompt: string, options: GenerateOptions): Promise<GenerateResult> {
    await sleep(options.json ? 220 : 180);
    return { text: respond(prompt, options), source: 'on_device' };
  },

  async *stream(prompt: string, options: GenerateOptions): AsyncIterable<GenerateChunk> {
    const full = respond(prompt, options);
    // Emit a few characters at a time, paced like a small on-device model (a couple of seconds
    // end to end), so the streaming UI is exercised realistically rather than flashing past.
    const step = Math.max(6, Math.round(full.length / 26));
    for (let i = step; i < full.length; i += step) {
      await sleep(80);
      yield { text: full.slice(0, i), source: 'on_device' };
    }
    yield { text: full, source: 'on_device' };
  },
};

function respond(prompt: string, options: GenerateOptions): string {
  if (options.system?.includes('Classify')) return '{"intent":"change"}';
  if (prompt.startsWith(EDIT_PREFIX)) {
    const json = prompt.slice(EDIT_PREFIX.length, prompt.indexOf('\n\nApply this change'));
    const change = prompt.slice(prompt.indexOf('return the full updated JSON: "') + 30).replace(/"\s*$/, '');
    return editSpec(json.trim(), change);
  }
  if (options.system?.includes('tiny single-screen apps')) {
    const hit = LIBRARY.find((l) => l.match.test(prompt));
    return hit ? hit.json : FALLBACK;
  }
  if (options.system?.includes('help a user understand')) {
    return 'This app takes what you type, sends it to a small on-device model, and saves the result locally. You could ask me to “add a field for the date” to keep a timeline.';
  }
  if (options.json) return '{"intent":"question"}';
  return 'Here is a short answer produced on this device. It never left your phone.';
}
