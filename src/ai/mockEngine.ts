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
    match: /shooter|invader|space|alien/i,
    json: `{"name":"Fish Patrol","emoji":"🐱","accent":"violet","description":"Steer your ship and stop the invaders.","components":[
      {"type":"game","id":"patrol","label":"Fish Patrol","game":"shooter","player":"🐱","item":"🐟"},
      {"type":"stat","id":"best","label":"Best","field":"patrol","op":"max","range":"all"},
      {"type":"history","label":"Scores"}]}`,
  },
  {
    match: /brick|breakout|paddle/i,
    json: `{"name":"Brick Bash","emoji":"🏓","accent":"rose","description":"Bounce the ball and break every brick.","components":[
      {"type":"game","id":"bash","label":"Brick Bash","game":"bricks"},{"type":"history","label":"Scores"}]}`,
  },
  {
    match: /catch|basket|collect/i,
    json: `{"name":"Fruit Fall","emoji":"🧺","accent":"teal","description":"Catch the fruit, dodge the bombs.","components":[
      {"type":"game","id":"fall","label":"Fruit Fall","game":"catch"},{"type":"history","label":"Scores"}]}`,
  },
  {
    match: /whack|mole|bop|reflex/i,
    json: `{"name":"Hamster Bop","emoji":"🐹","accent":"amber","description":"Bop them as they pop up.","components":[
      {"type":"game","id":"bop","label":"Hamster Bop","game":"whack"},{"type":"history","label":"Scores"}]}`,
  },
  {
    match: /tetris|falling block|blocks? game|stack/i,
    json: `{"name":"Block Drop","emoji":"🧱","accent":"violet","description":"Stack falling blocks and clear rows.","components":[
      {"type":"game","id":"drop","label":"Block Drop","game":"blocks","speed":"normal"},
      {"type":"stat","id":"best","label":"Best","field":"drop","op":"max","range":"all"},
      {"type":"history","label":"Scores","groupBy":"day"}]}`,
  },
  {
    match: /snake|worm/i,
    json: `{"name":"Apple Snake","emoji":"🐍","accent":"green","description":"Eat apples, grow longer, don’t bite yourself.","components":[
      {"type":"game","id":"snake","label":"Apple Snake","game":"snake","item":"🍎"},
      {"type":"history","label":"Scores"}]}`,
  },
  {
    match: /flappy|fly|bird|tap game/i,
    json: `{"name":"Sky Hop","emoji":"🐤","accent":"blue","description":"Tap to fly through the gaps.","components":[
      {"type":"game","id":"hop","label":"Sky Hop","game":"flyer","player":"🐤"},
      {"type":"history","label":"Scores"}]}`,
  },
  {
    match: /\bgames?\b|subway|runner|dodge|arcade/i,
    json: `{"name":"Cat Dash","emoji":"🐱","accent":"teal","description":"Dodge the dogs and beat your best run.","components":[
      {"type":"game","id":"dash","label":"Cat Dash","game":"runner","player":"🐱","item":"🐶","text":"Swipe left and right to dodge the dogs."},
      {"type":"stat","id":"best","label":"Best run","field":"dash","op":"max","range":"all"},
      {"type":"history","label":"Scores","groupBy":"day"}]}`,
  },
  {
    match: /calorie|food|meal|diet|nutrition|ate\b/i,
    json: `{"name":"Bite Log","emoji":"🍽️","accent":"amber","description":"Log meals and watch your daily calories.","components":[
      {"type":"stat","id":"kcal_today","label":"Today","field":"calories","op":"sum","range":"today","unit":"kcal"},
      {"type":"chart","id":"kcal_chart","label":"Calories per day","field":"calories","op":"sum","days":7,"unit":"kcal"},
      {"type":"input","id":"meal","label":"What did you eat?","placeholder":"Chicken salad and an apple"},
      {"type":"input","id":"calories","label":"Calories","kind":"number","unit":"kcal","placeholder":"450"},
      {"type":"ai","id":"estimate","label":"Estimate calories","prompt":"Estimate the total calories in: {meal}. Reply with just the number.","fills":"calories","auto":true},
      {"type":"ai","id":"review","label":"Review my day","prompt":"Here is what I ate today:\\n{today_entries}\\nIn 2 sentences, how balanced was it?"},
      {"type":"reminder","id":"log_meals","label":"Meal reminders","text":"Log what you ate","times":["08:00","13:00","19:00"]},
      {"type":"save","label":"Log meal"},{"type":"history","label":"Meals","groupBy":"day","total":"calories"}]}`,
  },
  {
    match: /interview|tough question|practi[cs]e|rehears|role.?play|speak|voice|talk/i,
    json: `{"name":"Interview Coach","emoji":"🎙️","accent":"blue","description":"Rehearse hard questions out loud and get honest feedback.","components":[
      {"type":"input","id":"role","label":"What role is it for?","placeholder":"Product manager"},
      {"type":"choice","id":"style","label":"How tough?","options":["Friendly","Realistic","Grill me"]},
      {"type":"voice","id":"practice","label":"Mock interview","prompt":"You are an interviewer for a {role} role. Style: {style}. Ask one tough question at a time and give one sentence of feedback after each answer.","text":"Let's begin. Tell me about a decision you made that turned out to be wrong."},
      {"type":"ai","id":"review","label":"Review my answers","prompt":"Here is an interview transcript: {practice}. In at most 5 lines starting with \\"- \\", say what went well and what to improve."},
      {"type":"save","label":"Save session"},{"type":"history","label":"Past sessions"}]}`,
  },
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
    match: /habit|streak|routine|daily|checklist/i,
    json: `{"name":"Morning Flow","emoji":"🌅","accent":"amber","description":"Tick off your morning and keep the streak alive.","components":[
      {"type":"stat","id":"streak","label":"Streak","op":"streak"},
      {"type":"chart","id":"done_chart","label":"Done per day","field":"steps","op":"max","days":7},
      {"type":"checklist","id":"steps","label":"This morning","options":["Glass of water","Stretch 5 min","Make the bed","Plan top 3 tasks"]},
      {"type":"input","id":"energy","label":"Energy","kind":"rating"},
      {"type":"ai","id":"coach","label":"Coach me","prompt":"My recent mornings:\\n{entries}\\nIn 2 short sentences, encourage me and suggest one tweak."},
      {"type":"save","label":"Done for today"},{"type":"history","label":"Past mornings","groupBy":"day","total":"steps"}]}`,
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
      {"type":"input","id":"amount","label":"How much?","kind":"number","unit":"$","placeholder":"12.50"},
      {"type":"choice","id":"category","label":"Category","options":["Food","Transport","Home","Fun","Health"]},
      {"type":"ai","id":"tip","label":"Money tip","prompt":"I spent {amount} on {item} ({category}). In one short sentence, give me a practical money tip."},
      {"type":"stat","id":"week","label":"This week","field":"amount","op":"sum","range":"week","unit":"$"},
      {"type":"save","label":"Add expense"},{"type":"history","label":"Spending","groupBy":"day","total":"amount"}]}`,
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
  // v2 blocks, so the mock can demonstrate them through chat too.
  const firstNumber = () => spec.components.find((x) => x.type === 'input' && x.kind === 'number');
  if (/total|sum|stat|how much|count/.test(c) && !spec.components.some((x) => x.type === 'stat')) {
    const num = firstNumber();
    spec.components.unshift(
      num
        ? { type: 'stat', id: 'total_today', label: 'Today', field: num.id, op: 'sum', range: 'today', unit: num.unit }
        : { type: 'stat', id: 'entries_today', label: 'Entries today', op: 'count', range: 'today' },
    );
  }
  if (/chart|graph/.test(c) && !spec.components.some((x) => x.type === 'chart')) {
    const num = firstNumber();
    spec.components.unshift(num ? { type: 'chart', id: 'per_day', label: 'Per day', field: num.id, op: 'sum', days: 7 } : { type: 'chart', id: 'per_day', label: 'Entries per day', op: 'count', days: 7 });
  }
  if (/checklist|routine|to-?do/.test(c) && !spec.components.some((x) => x.type === 'checklist')) {
    addField('__tmp', '');
    const i = spec.components.findIndex((x) => x.id === '__tmp');
    spec.components[i] = { type: 'checklist', id: 'routine', label: 'Today', options: ['Stretch', 'Water', 'Read'] };
  }
  if (/streak/.test(c) && !spec.components.some((x) => x.op === 'streak')) {
    spec.components.unshift({ type: 'stat', id: 'streak', label: 'Streak', op: 'streak' });
  }
  if (/rename|call it/.test(c)) {
    const m = change.match(/["“']([^"”']{2,30})["”']/);
    if (m) (spec as unknown as { name: string }).name = m[1];
  }
  return JSON.stringify(spec);
}

const EDIT_PREFIX = 'Current app JSON:';

/** Canned interviewer turns so the voice chat can be exercised without a model. */
const MOCK_INTERVIEW = [
  'Good, you owned the mistake instead of blaming others. Next: why are you leaving your current job?',
  'That was honest but a bit long; lead with the reason in one sentence. Now, tell me about a conflict with a teammate.',
  'Nice use of a concrete example. Last one: what would your first ninety days here look like?',
];

/** Tests read this to check how many model requests an action made. */
const countCall = () => {
  const g = globalThis as { __mockCalls?: number };
  g.__mockCalls = (g.__mockCalls ?? 0) + 1;
};

/**
 * Tests set `__mockNoNano` to act like a phone without Gemini Nano: the on-device model is
 * unavailable, so on-device-only requests (offline, private mode) fail as they would there.
 */
const noNano = () => !!(globalThis as { __mockNoNano?: boolean }).__mockNoNano;
const deviceCheck = (options: GenerateOptions) => {
  if (noNano() && options.mode === 'only_on_device') throw new Error('On-device AI isn’t available on this phone (mock).');
};

export const mockEngine: AIEngine = {
  runtime: 'none',
  streaming: true,

  async status(): Promise<DeviceStatus> {
    return noNano() ? 'unavailable' : 'available';
  },

  async download(): Promise<DeviceStatus> {
    await sleep(120);
    return 'available';
  },

  async generate(prompt: string, options: GenerateOptions): Promise<GenerateResult> {
    countCall();
    await sleep(options.json ? 220 : 180);
    deviceCheck(options);
    // Lets tests exercise error paths: any prompt mentioning this fails like an unreachable model.
    if (prompt.includes('mock-fail')) throw new Error('The AI could not be reached (mock failure).');
    return { text: respond(prompt, options), source: 'on_device' };
  },

  async *stream(prompt: string, options: GenerateOptions): AsyncIterable<GenerateChunk> {
    countCall();
    deviceCheck(options);
    if (prompt.includes('mock-fail')) throw new Error('The AI could not be reached (mock failure).');
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

/** A chat turn in the single-request format: {"reply", "app"}. */
function chatTurn(prompt: string): string {
  const json = prompt.slice('App JSON:'.length, prompt.indexOf('\n\n')).trim();
  const message = prompt.slice(prompt.lastIndexOf('User:') + 5).trim();
  if (/internet|website|photo|picture|camera|weather|stock/i.test(message)) {
    return JSON.stringify({ reply: 'Apps here can’t reach the internet or take photos. You could add a field to type it in, and an AI button to make sense of it.', app: null });
  }
  if (/\?$/.test(message) && !/^(can|could|would) you\b/i.test(message)) {
    return JSON.stringify({ reply: 'This app saves what you type on your phone and uses a small AI to help with it. You could ask me to “add a daily total” to see your numbers add up.', app: null });
  }
  const app = editSpec(json, message);
  return `{"reply":"Done, I updated the app.","app":${app}}`;
}

function respond(prompt: string, options: GenerateOptions): string {
  if (options.system?.includes('{"reply":string')) return chatTurn(prompt);
  if (options.system?.includes('Classify')) return '{"intent":"change"}';
  if (options.system?.includes('talking out loud')) {
    const turns = (prompt.match(/^User:/gm) ?? []).length;
    return MOCK_INTERVIEW[(turns - 1) % MOCK_INTERVIEW.length];
  }
  if (prompt.startsWith(EDIT_PREFIX)) {
    const json = prompt.slice(EDIT_PREFIX.length, prompt.indexOf('\n\nApply this change'));
    const change = prompt.slice(prompt.indexOf('return the full updated JSON: "') + 30).replace(/"\s*$/, '');
    return editSpec(json.trim(), change);
  }
  if (options.system?.includes('tiny single-screen apps')) {
    // Match only the user's request, not the example the prompt starts with.
    const request = prompt.slice(prompt.lastIndexOf('Now design an app for:'));
    const hit = LIBRARY.find((l) => l.match.test(request));
    return hit ? hit.json : FALLBACK;
  }
  if (options.system?.includes('help a user understand')) {
    return 'This app takes what you type, sends it to a small on-device model, and saves the result locally. You could ask me to “add a field for the date” to keep a timeline.';
  }
  if (options.json) return '{"intent":"question"}';
  if (/just the number/i.test(prompt)) return String(300 + (prompt.length % 7) * 50);
  return 'Here is a short answer produced on this device. It never left your phone.';
}
