import { ACCENTS } from '../spec/types';

/**
 * Kept short on purpose: Gemini Nano has a small context window.
 * The same prompt works in the cloud, which just follows it more creatively.
 */
export const SPEC_SYSTEM = `You design tiny single-screen apps. Reply with ONLY one JSON object:
{"name":string,"emoji":string,"accent":one of ${ACCENTS.join('|')},"description":string,"code":string (optional, see below),"components":[...]}
Component types:
- heading {text} / text {text}: static text
- input {id,label,placeholder,kind,unit,multiline}: a field. kind is "text" (default), "number" (with optional unit like "kcal", "$", "min"), "yesno", "rating" (1-5 stars) or "date". multiline only for text
- choice {id,label,options:[2-6 strings]}: user picks one
- checklist {id,label,options:[1-12 short items]}: tick-off list for routines; saves which items were done
- ai {id,label,prompt,fills,auto}: a button; prompt is an instruction for a small AI. Placeholders: {field_id} = what the user typed; {today_entries} = entries saved today; {entries} = recent saved entries; {today} = today's date. fills = id of an input the answer is written into (e.g. estimate calories into a number field); never a field the prompt reads. auto:true also runs it when the user saves
- stat {id,label,field,op,range,unit}: a big number computed from saved entries. op: sum|avg|count|min|max|latest|streak. range: today|week|all. field = an input, choice, checklist or ai id (not needed for count/streak)
- chart {id,label,field,op,days,unit}: bars per day over the last days (7-31). op: sum|avg|count|max|min
- voice {id,label,prompt,text}: a spoken conversation with the AI (the user talks, the AI talks back out loud). prompt says who the AI plays and its goal, and may use {field_id} and {entries}; text is the AI's short opening line
- reminder {id,label,text,times:["HH:MM",...]}: daily phone notifications the user can switch on; text is the short notification message, times are 1-4 times of day in 24-hour format
- game {id,label,game,speed,player,item,text}: a built-in arcade game, played full screen with score, lives, levels and a high-score table; every finished run saves its score. game: "blocks" (falling blocks: move, rotate, clear rows), "runner" (dodge obstacles across 3 lanes), "snake" (grow by eating), "flyer" (tap to fly through gaps), "bricks" (paddle and ball breaking bricks), "shooter" (ship fires up at descending enemies), "catch" (move a basket to catch good things and avoid bombs) or "whack" (tap targets as they pop up). speed: slow|normal|fast. player = one emoji for the player (runner, flyer, shooter, catch); item = one emoji for obstacles (runner), food (snake), enemies (shooter), good things to catch (catch) or targets (whack). text = one short line on how to play
- random {id,label,roll,count,sides,options,min,max,text}: dice and chance, every result saved. roll: "dice" (count 1-6 dice with sides 2-100), "coin" (heads or tails), "pick" (spins to pick one of options: a decision wheel, a card, a dare) or "number" (min to max). label is the button ("Roll", "Flip", "Spin"). Blocks can work together: countFrom, sidesFrom, minFrom, maxFrom or optionsFrom = the id of a choice or input on the screen whose current value sets that, e.g. a choice "How many dice?" with options "1","2","3","4" and countFrom set to its id, or an input listing names with optionsFrom so the spinner picks one of them. Such control fields need no save block
- save {label}: saves the fields, checklist ticks and AI results as one entry
- history {label,groupBy,total}: lists saved entries. groupBy:"day" groups them under each day; total = a number or checklist field summed per day
Rules: 3-12 components. ids are lowercase_snake. Every ai prompt uses a {placeholder} and asks for a short answer.
The AI only sees what the user typed and saved: no internet, no images, no live data.
Make it feel like a polished app:
- name: 1-3 words, Title Case. description: one sentence about the benefit, under 12 words.
- emoji and accent fit the topic. Order: stats/charts, fields/checklists, ai buttons, voice, save, history.
- Use the right field kind: amounts and counts are "number" with a unit, did-you questions are "yesno", how-good questions are "rating". Labels are short and human, often a question. Placeholders are a concrete example.
- Trackers (food, water, money, workouts, sleep, habits): number fields, a stat for today's total or a streak, a chart, history grouped by day with a total. If the user won't know the number (calories in a meal), add an ai that estimates it with fills and auto:true.
- Routines and habits: a checklist, a streak stat, a chart of items done per day.
- Journals and reflection: a multiline text field, maybe a rating, an ai that reflects on {entry}, an ai that looks back over {entries} for patterns.
- Games: one game block, an optional stat of the best score (field = the game id, op "max", range "all"), and history labelled "Scores". No save block, no inputs needed. Fit the theme with player/item emoji (a cat dodging dogs: player "🐱", item "🐶"). Always give the game an original name: never use the name of an existing game or brand (if asked for a well-known game, make the closest built-in game under a new name).
- Dice, coin flips, spinners, random picks, lucky draws: a random block, a stat of the highest or latest result (field = its id), history labelled "Rolls". No save block.
- When the user wants an app or game these blocks can't really do, still build the closest app from blocks AND set "code" to 1-3 sentences describing exactly what to build. A custom version is then written in code from it. Examples: apps like a timer, stopwatch or pomodoro, a calculator or unit converter, a kanban board or drag-to-sort list, a drawing pad, a flashcard deck that flips, a budget split between people, a seating chart; games like chess, checkers, memory cards, a puzzle, a timed quiz, a board or card game, physics, or one with its own rules. For an app, say what the screen shows and what each control does; for a game, the rules, controls and scoring. If the user asks for code, HTML or a custom version, always set "code". Leave "code" out when the blocks do it well: never for a game a built-in game covers (falling blocks, lane runner, snake, flappy-style flyer, bricks, space shooter, catching, whack-a-mole: use the game block), nor for trackers, journals, lists, checklists or AI helpers. Custom code runs alone on the phone with no internet, camera, photos, contacts or other people, so never set "code" for live data (weather, prices, news), photo or camera tools, or social and sharing apps: build what the blocks can (log it, type it in) instead.
- Coaches and practice: a voice block with a clear role; a text field for the topic it uses as {field_id}; optionally an ai that gives feedback.
- ai labels: a verb, 1-3 words ("Tag my mood"). Use 1-3 ai buttons, each doing something clearly different.
- Use one reminder block for regular habits or logs, e.g. meals at ["08:00","13:00","19:00"] or one evening check-in at ["20:00"].
- ai prompts ask for at most 3 sentences or at most 5 lines starting with "- ".
- Prefer a choice over an input when there are a few fixed options.`;

const GAME_EXAMPLE = `Example for "a game where a cat dodges dogs":
{"name":"Cat Dash","emoji":"🐱","accent":"teal","description":"Dodge the dogs and beat your best run.","components":[{"type":"game","id":"dash","label":"Cat Dash","game":"runner","speed":"normal","player":"🐱","item":"🐶","text":"Swipe left and right to dodge the dogs."},{"type":"stat","id":"best","label":"Best run","field":"dash","op":"max","range":"all"},{"type":"history","label":"Scores","groupBy":"day"}]}`;

const DICE_EXAMPLE = `Example for "roll two dice":
{"name":"Lucky Dice","emoji":"🎲","accent":"rose","description":"Roll two dice and chase your best total.","components":[{"type":"random","id":"roll","label":"Roll","roll":"dice","count":2,"sides":6},{"type":"stat","id":"best","label":"Best roll","field":"roll","op":"max","range":"all"},{"type":"history","label":"Rolls","groupBy":"day"}]}`;

const EXAMPLES: { match: RegExp; text: string }[] = [
  {
    match: /\bdice\b|\bdie\b|\broll|coin|flip|spinner|spin the|wheel|random|lottery|raffle|decide for me|pick for me|draw a card/i,
    text: DICE_EXAMPLE,
  },
  {
    match: /\bgames?\b|arcade|tetris|snake|flappy|subway|runner|dodge|high ?score/i,
    text: GAME_EXAMPLE,
  },
  {
    match: /calor|food|meal|eat|water|drink|spend|expense|money|budget|workout|run|steps|sleep|weight|track|log|count/i,
    text: `Example for "log what I eat and count calories":
{"name":"Bite Log","emoji":"🍽️","accent":"amber","description":"Log meals and watch your daily calories.","components":[{"type":"stat","id":"kcal_today","label":"Today","field":"calories","op":"sum","range":"today","unit":"kcal"},{"type":"chart","id":"kcal_chart","label":"Calories per day","field":"calories","op":"sum","days":7,"unit":"kcal"},{"type":"input","id":"meal","label":"What did you eat?","placeholder":"Turkey sandwich and an apple"},{"type":"input","id":"calories","label":"Calories","kind":"number","unit":"kcal","placeholder":"450"},{"type":"ai","id":"estimate","label":"Estimate calories","prompt":"Estimate the total calories in: {meal}. Reply with just the number.","fills":"calories","auto":true},{"type":"ai","id":"review","label":"Review my day","prompt":"Here is what I ate today:\\n{today_entries}\\nIn 2 sentences, how balanced was it and what could I add?"},{"type":"reminder","id":"remind","label":"Meal reminders","text":"Log what you ate","times":["08:30","13:00","19:30"]},{"type":"save","label":"Log meal"},{"type":"history","label":"Meals","groupBy":"day","total":"calories"}]}`,
  },
  {
    match: /habit|routine|checklist|morning|evening|daily|streak|chore|todo|to-do/i,
    text: `Example for "morning routine checklist":
{"name":"Morning Flow","emoji":"🌅","accent":"amber","description":"Tick off your morning and keep the streak alive.","components":[{"type":"stat","id":"streak","label":"Streak","op":"streak"},{"type":"chart","id":"done_chart","label":"Done per day","field":"steps","op":"max","days":14},{"type":"checklist","id":"steps","label":"This morning","options":["Glass of water","Stretch 5 min","Make the bed","Plan top 3 tasks"]},{"type":"input","id":"energy","label":"Energy","kind":"rating"},{"type":"save","label":"Done for today"},{"type":"history","label":"Past mornings","groupBy":"day","total":"steps"}]}`,
  },
  {
    match: /practi|interview|rehears|coach|speak|talk|conversation|language|pitch|negotiat|role.?play/i,
    text: `Example for "practice for tough interview questions":
{"name":"Interview Coach","emoji":"🎤","accent":"blue","description":"Rehearse hard questions out loud and get feedback.","components":[{"type":"input","id":"role","label":"What role is it for?","placeholder":"Product manager at a startup"},{"type":"voice","id":"mock","label":"Mock interview","prompt":"You are a tough but fair interviewer for a {role} job. Ask one hard question at a time and give one line of feedback on each answer.","text":"Thanks for coming in. Tell me about yourself."},{"type":"ai","id":"feedback","label":"Score my answers","prompt":"Here is an interview transcript:\\n{mock}\\nGive 3 lines starting with \\"- \\": one strength, one weakness, one tip."},{"type":"stat","id":"sessions","label":"Sessions","op":"count","range":"week"},{"type":"save","label":"Save session"},{"type":"history","label":"Past sessions"}]}`,
  },
];

const JOURNAL_EXAMPLE = `Example for "journal that tags my mood":
{"name":"Mood Journal","emoji":"😊","accent":"violet","description":"Write about your day and spot patterns.","components":[{"type":"input","id":"entry","label":"How was your day?","multiline":true,"placeholder":"Long meeting, but a good walk after"},{"type":"input","id":"rating","label":"How do you feel?","kind":"rating"},{"type":"ai","id":"mood","label":"Tag my mood","prompt":"Read this journal entry and reply with one emoji and one word for the mood: {entry}"},{"type":"ai","id":"patterns","label":"Find patterns","prompt":"Here are my recent journal entries:\\n{entries}\\nIn 3 lines starting with \\"- \\", what patterns do you notice?"},{"type":"stat","id":"avg","label":"Average mood","field":"rating","op":"avg","range":"week"},{"type":"save","label":"Save entry"},{"type":"history","label":"Past entries","groupBy":"day"}]}`;

/** Picks the example closest to the request, so the model copies the right patterns. */
export function specExample(request: string) {
  return EXAMPLES.find((e) => e.match.test(request))?.text ?? JOURNAL_EXAMPLE;
}

/** Kept for callers that want a fixed example. */
export const SPEC_EXAMPLE = JOURNAL_EXAMPLE;

export function specPrompt(request: string) {
  return `${specExample(request)}\n\nNow design an app for: "${request.trim()}"`;
}

export function editSpecPrompt(currentJson: string, change: string) {
  return `Current app JSON:\n${currentJson}\n\nApply this change and return the full updated JSON: "${change.trim()}"`;
}

/** Cloud only: Gemini writes a fully custom, self-contained HTML app. */
export const HTML_SYSTEM = `You write one self-contained mobile-first HTML file for a small app.
Hard rules:
- Output ONLY the HTML document, starting with <!doctype html>.
- No external resources: no <script src>, no CDN, no fonts, no images from URLs, no fetch/XMLHttpRequest/WebSocket.
- Inline all JS. von mini's design system is already loaded (the app's own theme, light or dark): build the whole look from it so the app looks like the rest of von mini.
  Classes: layout .vm-stack .vm-row .vm-grid · panels .vm-hero .vm-card · text .vm-title .vm-headline .vm-overline .vm-muted · a big number .vm-stat
  forms .vm-label .vm-input (inputs, textareas and selects are styled already) · buttons .vm-btn .vm-btn-secondary .vm-btn-block (plain <button> is styled too) · .vm-chip (toggle aria-pressed) · lists .vm-list > li · AI output .vm-result · .vm-badge .vm-empty .vm-spinner
  CSS variables for anything custom (canvas, SVG, games): var(--vm-bg) var(--vm-surface) var(--vm-surface-alt) var(--vm-text) var(--vm-muted) var(--vm-border) var(--vm-accent) var(--vm-accent-soft) var(--vm-on-accent) var(--vm-danger) var(--vm-success), the comic font var(--vm-display), borders var(--vm-stroke) and shadows var(--vm-shadow). In canvas code read them with getComputedStyle(document.documentElement).
- Never set your own colours, fonts, backgrounds, gradients or shadows, and never restyle body. Extra CSS only for layout specific to this app.
- Use the full screen width: the page already has its small side padding, so add no outer margins, padding, max-width or centred wrappers. Never put a .vm-card inside another .vm-card or .vm-hero; inside a card use plain elements, a .vm-result or a .vm-list.
- It must work the first time: put your <script> at the end of <body>, attach handlers with addEventListener, and make every button and control do something visible. Wrap start-up code in try/catch and show a friendly message instead of a blank or frozen screen. Use only standard browser JavaScript you are sure of.
- Render on the page right away: the first screen shows the real app (inputs, board, current stats), never a blank page or only a start button with nothing around it. Everything fits the screen width (360px and up) with no sideways scrolling.
- Structure: a .vm-hero with the app name and one-line purpose, the main controls in a .vm-card, primary action as .vm-btn.vm-btn-block, results in .vm-result, saved items as a .vm-list, an empty state with .vm-empty.
- Show a .vm-spinner and disable the button while vonmini.ai is running, and show friendly error text if it fails.
- For AI features call: await vonmini.ai(promptString) -> string. It runs on a small on-device model, so ask for short outputs and keep prompts simple.
- Voice (all on the device, so it works offline):
  await vonmini.listen() -> string: listens to the user once and returns what they said ('' if nothing).
  await vonmini.speak(text): says text out loud; await vonmini.stopSpeaking().
  await vonmini.converse(persona, history) -> string: history is [{role:'user'|'assistant', text}] ending with the user's turn; the AI replies in the role described by persona and the reply is spoken aloud as it is written.
  For practice/rehearsal/role-play apps, build a voice conversation: a big round mic button that calls listen() then converse(), a transcript of turns as chat bubbles, a "hands-free" toggle that listens again after each reply, a stop button, and a text box to type instead of speaking. Show the state (Listening / Thinking / Speaking).
- For persistence call: await vonmini.store.get(key) -> any|null and await vonmini.store.set(key, value).
- Never use localStorage, cookies or alert().
- Daily reminders are handled by the app around your HTML: don't build reminder UI.
- Save each entry as an item in a list under one key (e.g. vonmini.store "entries": [{at, ...fields}]) and compute totals, streaks and charts from it; draw charts with inline SVG.
Games and toys:
- Draw on a <canvas> sized to the screen (devicePixelRatio aware) and animate with requestAnimationFrame; or use DOM for board and card games.
- Touch first: tap, drag and swipe with pointer events; big hit areas; no hover. Arrow keys and space as extras.
- Minimal arcade look: a score and best score at the top, a "Tap to start" screen, a game-over card with the score and a Play again button, pause when the page is hidden.
- Keep a top-5 high-score table with vonmini.store (key "scores", a list of {score, at}) and show it on the game-over card.
- Use emoji as sprites; no images. Make it fair and fun: a gentle start that speeds up, clear feedback when scoring or losing.
- Colours come from the theme variables (board var(--vm-surface-alt), lines var(--vm-border), highlights var(--vm-accent)), so the game fits light and dark mode; at most 4 colours of your own, only for game pieces.
- Steady motion: advance the game by elapsed time (dt from requestAnimationFrame timestamps, capped at 0.1 s), never by a fixed amount per frame.
- Never copy an existing commercial game's name, characters or look; make an original game in that style.`;

export function htmlPrompt(request: string, specJson?: string, brief?: string, currentHtml?: string, errors?: string[]) {
  if (currentHtml && errors?.length) {
    // A repair: the app broke when it ran. Fix it, change nothing else.
    return `This app throws these errors when it runs, so parts of it do nothing:\n${errors.map((e) => `- ${e}`).join('\n')}\nFix them so every control works, and check the rest of the script for the same kind of mistake. Change nothing else: keep its design, wording and the vonmini.store keys it uses.\nApp JSON (the plan):\n${specJson ?? '{}'}\nCurrent HTML:\n${currentHtml.slice(0, 40000)}`;
  }
  const latest = brief?.match(/\n\nLatest change #\d+: ([\s\S]+)$/)?.[1];
  if (currentHtml && latest) {
    // A chat edit: make exactly this change to the app the user already has.
    return `The user asked for this change to their app: "${latest.trim()}"\nMake that change in the HTML below so it visibly works, and change nothing else: keep its design, layout, wording and the vonmini.store keys it uses. Return the full updated HTML.\nWhat the app is: ${brief!.split('\n\nLatest change')[0].trim()}\nApp JSON (the plan):\n${specJson ?? '{}'}\nCurrent HTML:\n${currentHtml.slice(0, 40000)}`;
  }
  if (currentHtml && brief) {
    // An edit: change the app the user already has, so its look and saved data carry over.
    return `Here is the app's current HTML. Update it to match this brief, changing only what the brief asks; keep its design, layout, wording and the vonmini.store keys it uses.\nBrief: ${brief.trim()}\nApp JSON (the plan):\n${specJson ?? '{}'}\nCurrent HTML:\n${currentHtml.slice(0, 40000)}`;
  }
  if (brief) {
    return `Build this: ${brief.trim()}\nUse the blocks in the App JSON as the plan: every field, choice, checklist, stat, chart, AI button, dice, game and history list it describes should exist and work in your HTML (stats and history read the entries you save with vonmini.store), connected as described; then add whatever else the request needs. Use its name, emoji and purpose.\nApp JSON:\n${specJson ?? '{}'}\nUser's original request: "${request}"`;
  }
  return specJson
    ? `Build a richer custom version of this app. Keep its purpose and features, improve layout and interactions.\nApp JSON:\n${specJson}\nUser's original request: "${request}"`
    : `Build this app: "${request.trim()}"`;
}

/**
 * One chat turn about an app, in a single request: the model either answers or returns the
 * updated app, so a message never costs a separate "is this a change?" call.
 */
export const CHAT_TURN_RULES = `Now you are chatting with the user about the app they already built (its JSON is in the message).
Reply with ONLY one JSON object, "reply" first: {"reply":string,"app":object|null}
- If the user wants the app changed in any way (add, remove, rename, reword, restyle, fix, track something new, make it do more), set "app" to the FULL updated app JSON in the format above, keeping the ids and wording of blocks you didn't change. "reply" is one short sentence saying what you changed.
- If the user says something is broken or wrong without saying what ("fix it", "it doesn't work"), and the conversation doesn't make it clear, change nothing: set "app" to null and ask in "reply" which part and what it does wrong.
- If the user asks a question or is chatting, set "app" to null and answer in "reply" in 1-3 short, friendly sentences. Explain blocks in plain words, never JSON. When useful, end with one concrete change they could ask for.
- When they want one block to control another ("the choice should set how many dice roll", "spin from the names I type"), connect them with countFrom / sidesFrom / minFrom / maxFrom / optionsFrom on the random block; never add an ai button or "code" for that.
- If they want something the blocks can't do (a timer, calculator, board, drag-and-drop, drawing, a different game, its own rules, a timed quiz) or ask for code / a custom version, return the app with the closest blocks AND "code" set to 1-3 sentences describing exactly what to build, including what they just asked; "reply" says a custom version is being written. An app with "code" is shown as its code version: to change it, rewrite "code" to include the change. To go back to the blocks, leave "code" out.
- If what they ask is impossible in any app (internet, photos, live data, other apps), set "app" to null and say in "reply" what the app can do instead.
- Never answer with "app" equal to the current app: either change something or use null.`;

export function chatTurnPrompt(specJson: string, history: { role: string; text: string }[], message: string) {
  const convo = history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');
  return `App JSON:\n${specJson}\n\n${convo ? `Conversation so far:\n${convo}\n\n` : ''}User: ${message.trim()}`;
}

/** JSON schema for a chat turn, for runtimes that can constrain output (Gemini Nano on the web). */
export const chatTurnJsonSchema = (app: object) => ({
  type: 'object',
  properties: { reply: { type: 'string' }, app: { anyOf: [app, { type: 'null' }] } },
  required: ['reply', 'app'],
});

export const ACTION_SYSTEM =
  'You are a helpful assistant inside a small personal app. Answer briefly and directly. Plain text only, no markdown headings.';
