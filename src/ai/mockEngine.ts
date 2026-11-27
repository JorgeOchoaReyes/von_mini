/**
 * Development-only mock engine.
 *
 * Enabled only when `EXPO_PUBLIC_MOCK_ENGINE=true` **and** the bundle is a development build, so
 * it can never be reached in a release build. It exists so the build/edit/undo flows can be
 * exercised on a machine that has no Gemini Nano (for example CI, or a Linux VM used to take
 * screenshots for the submission). It answers with the same shapes the real engine returns.
 */
import { rcString } from '../remote/remoteConfig';
import type { AIEngine, DeviceStatus, GenerateChunk, GenerateOptions, GenerateResult } from './types';

export const mockEnabled = __DEV__ && process.env.EXPO_PUBLIC_MOCK_ENGINE === 'true';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Canned specs so the mock produces believable apps for the demo flows. */
const LIBRARY: { match: RegExp; json: string }[] = [
  {
    match: /timer|stopwatch|pomodoro|calculator|converter|kanban/i,
    json: `{"name":"Focus Timer","emoji":"⏱️","accent":"blue","description":"Focus in sprints and log each session.","code":"A pomodoro timer: a big 25:00 countdown with start, pause and reset, a 5-minute break after each sprint, and a count of sprints done today saved with vonmini.store.","components":[
      {"type":"input","id":"task","label":"What are you focusing on?","placeholder":"Write the report"},{"type":"input","id":"minutes","label":"Minutes","kind":"number","unit":"min"},{"type":"stat","id":"total","label":"Focused today","field":"minutes","op":"sum","range":"today","unit":"min"},{"type":"save","label":"Log session"},{"type":"history","label":"Sessions","groupBy":"day"}]}`,
  },
  {
    match: /memory|matching|chess|checkers|tic.?tac|quiz|drawing|card game|board game/i,
    json: `{"name":"Match Up","emoji":"🃏","accent":"teal","description":"Flip cards, find pairs, beat your best time.","code":"A memory game: 16 face-down emoji cards in a 4x4 grid. Tap two to flip; a pair stays up. Score is 100 minus moves; best scores saved.","components":[
      {"type":"game","id":"match","label":"Match Up","game":"whack","item":"🃏"},{"type":"stat","id":"best","label":"Best","field":"match","op":"max","range":"all"},{"type":"history","label":"Scores"}]}`,
  },
  {
    match: /\bdice\b|\bdie\b|roll|coin|flip|spinner|decide for me/i,
    json: `{"name":"Lucky Dice","emoji":"🎲","accent":"rose","description":"Roll two dice and chase your best total.","components":[
      {"type":"random","id":"roll","label":"Roll","roll":"dice","count":2,"sides":6},{"type":"stat","id":"best","label":"Best roll","field":"roll","op":"max","range":"all"},{"type":"history","label":"Rolls","groupBy":"day"}]}`,
  },
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

  // Games and chance: dice turn the main game into a dice roll; other gameplay asks for a custom version.
  // One block controlling another: a choice that sets how many dice roll.
  if (/how many dice|number of dice/.test(c)) {
    const dice = spec.components.find((x) => x.type === 'random');
    if (dice) {
      spec.components.splice(spec.components.indexOf(dice), 0, { type: 'choice', id: 'how_many', label: 'How many dice?', options: ['1', '2', '3', '4'] });
      dice.countFrom = 'how_many';
      return JSON.stringify(spec);
    }
  }
  if (/\bdice\b|\broll/.test(c)) {
    const at = spec.components.findIndex((x) => x.type === 'game' || x.type === 'random');
    const dice = { type: 'random', id: 'roll', label: 'Roll', roll: 'dice', count: /two|2/.test(c) ? 2 : 1, sides: 6 };
    if (at >= 0) spec.components.splice(at, 1, dice);
    else spec.components.unshift(dice);
    return JSON.stringify(spec);
  }
  if (/memory|chess|checkers|tic.?tac|own rules|custom/.test(c)) {
    return JSON.stringify({ ...spec, code: `A custom game: ${change}. Tap to play, score shown at the top, best scores saved.` });
  }
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
    // Writing an app's HTML takes a while in the cloud; long enough to see "Building your app…".
    await sleep(options.system?.includes('self-contained mobile-first HTML') ? 1500 : options.json ? 220 : 180);
    deviceCheck(options);
    // Lets tests exercise error paths: any prompt mentioning this fails like an unreachable model.
    if (prompt.includes('mock-fail')) throw new Error('The AI could not be reached (mock failure).');
    return { text: respond(prompt, options), source: 'on_device' };
  },

  async *stream(prompt: string, options: GenerateOptions): AsyncIterable<GenerateChunk> {
    countCall();
    deviceCheck(options);
    if (prompt.includes('mock-fail')) throw new Error('The AI could not be reached (mock failure).');
    const html = options.system?.includes('self-contained mobile-first HTML');
    const limit = new Error('Content generation stopped. Reason: MAX_TOKENS');
    // The output limit, the way Android reports it: the strong model spends it all thinking.
    if (html && prompt.includes('mock-thinkall') && options.model && options.model !== rcString('cloud_model')) throw limit;
    // Or the file is cut off part-way and must be continued.
    if (html && prompt.includes('mock-cutoff')) {
      const all = respond(prompt.replace(/mock-cutoff/g, ''), options);
      if (prompt.includes('cut off by the length limit')) {
        yield { text: all.slice(all.indexOf('<div class="vm-muted" id="opens">')), source: 'in_cloud' };
        return;
      }
      yield { text: all.slice(0, all.indexOf('<div class="vm-muted" id="opens">')), source: 'in_cloud' };
      throw limit;
    }
    // A big app (~150 KB, many comments), streamed in many chunks the way a long game arrives.
    if (html && prompt.includes('mock-big')) {
      const body = Array.from({ length: 1500 }, (_, i) => `<!-- row ${i} --><div class="vm-muted" data-i="${i}">Lane ${i} of the long road</div>`).join('\n');
      const big = respond(prompt.replace(/mock-big/g, ''), options).replace('</body>', `${body}\n</body>`);
      const step = Math.max(200, Math.round(big.length / 600));
      for (let i = step; i < big.length; i += step) {
        await sleep(2);
        yield { text: big.slice(0, i), source: 'in_cloud' };
      }
      yield { text: big, source: 'in_cloud' };
      return;
    }
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

/** A tiny but real custom game, so the code-mode flow can be exercised end to end. */
const MOCK_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><div class="vm-stack"><div class="vm-hero"><div class="vm-title">Tap Rush</div><div class="vm-muted">Tap the target as fast as you can.</div></div>
<div class="vm-card vm-stack"><div class="vm-headline">Score <span id="score">0</span> · Best <span id="best">0</span></div>
<button id="tap" class="vm-btn vm-btn-block">Tap!</button></div></div>
<div class="vm-muted" id="opens"></div>
<script>let s=0,b=0;vonmini.store.get('best').then(v=>{b=v||0;document.getElementById('best').textContent=b});
const n=+(localStorage.getItem('opens')||0)+1;localStorage.setItem('opens',n);document.getElementById('opens').textContent='Opened '+n+' times';
document.getElementById('tap').onclick=()=>{s++;document.getElementById('score').textContent=s;if(s===3)alert('Nice streak!');if(s>b){b=s;document.getElementById('best').textContent=b;vonmini.store.set('best',b)}};</script></body></html>`;

/** An app whose button throws, to exercise the self-repair (asked for with "buggy" in tests). */
const MOCK_BUGGY_HTML = `<!doctype html><html><head></head><body><div class="vm-hero"><div class="vm-title">Buggy Dice</div></div>
<button id="roll" class="vm-btn vm-btn-block">Roll</button><script>document.getElementById('roll').addEventListener('click',()=>{rollTheDice()});</script></body></html>`;

function respond(prompt: string, options: GenerateOptions): string {
  if (options.system?.includes('self-contained mobile-first HTML')) {
    const repair = prompt.includes('throws these errors');
    // A chat edit shows what it applied, so tests can see the app really changed.
    const asked = prompt.match(/asked for this change to their app: "([^"]+)"/)?.[1];
    // Edits answer with an edit block, like the real model is asked to.
    if (asked && prompt.includes('>>>>>>> REPLACE')) {
      return `<<<<<<< SEARCH\n</body>\n=======\n<div class="vm-card">Change applied: ${asked}</div></body>\n>>>>>>> REPLACE`;
    }
    const html = !repair && /buggy/i.test(prompt) ? MOCK_BUGGY_HTML : MOCK_HTML;
    return '```html\n' + (asked ? html.replace('</body>', `<div class="vm-card">Change applied: ${asked}</div></body>`) : html) + '\n```';
  }
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
