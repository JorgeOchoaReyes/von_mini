import { ACCENTS } from '../spec/types';

/**
 * Kept short on purpose: Gemini Nano has a small context window.
 * The same prompt works in the cloud, which just follows it more creatively.
 */
export const SPEC_SYSTEM = `You design tiny single-screen apps. Reply with ONLY one JSON object:
{"name":string,"emoji":string,"accent":one of ${ACCENTS.join('|')},"description":string,"components":[...]}
Component types:
- heading {text} / text {text}: static text
- input {id,label,placeholder,multiline}: user types text
- choice {id,label,options:[2-6 strings]}: user picks one
- ai {id,label,prompt}: a button; prompt is an instruction for a small AI that reads the inputs, written with {input_id} placeholders
- voice {id,label,prompt,text}: a spoken conversation with the AI (the user talks, the AI talks back out loud). prompt says who the AI plays and its goal, and may use {input_id}; text is the AI's short opening line
- save {label}: saves inputs and AI results
- history {label}: lists saved entries
Rules: 3-9 components. ids are lowercase_snake. Every ai prompt uses at least one {input_id} and asks for a short answer.
The AI only sees what the user typed: no internet, no images, no live data.
Make it feel like a polished app:
- name: 1-3 words, Title Case. description: one sentence about the benefit, under 12 words.
- emoji and accent fit the topic. Order: inputs/choices, then ai buttons, then save, then history.
- input labels: short and human, often a question ("How did you sleep?"). placeholders: a concrete example.
- ai labels: a verb, 1-3 words ("Tag my mood"). Use 1-2 ai buttons, each doing something clearly different.
- Use a voice block when the user wants to practice, rehearse, role-play or talk something through (interviews, languages, tough conversations). Its prompt gives a clear role, e.g. "You are a tough but fair interviewer for a {role} job. Ask one hard question at a time and give brief feedback on each answer."
- ai prompts ask for at most 3 sentences or at most 5 lines starting with "- ".
- Prefer a choice over an input when there are a few fixed options.`;

export const SPEC_EXAMPLE = `Example for "journal that tags my mood":
{"name":"Mood Journal","emoji":"😊","accent":"violet","description":"Write about your day and get a mood tag.","components":[{"type":"input","id":"entry","label":"How was your day?","multiline":true},{"type":"ai","id":"mood","label":"Tag my mood","prompt":"Read this journal entry and reply with one emoji and one word for the mood: {entry}"},{"type":"save","label":"Save entry"},{"type":"history","label":"Past entries"}]}`;

export function specPrompt(request: string) {
  return `${SPEC_EXAMPLE}\n\nNow design an app for: "${request.trim()}"`;
}

export function editSpecPrompt(currentJson: string, change: string) {
  return `Current app JSON:\n${currentJson}\n\nApply this change and return the full updated JSON: "${change.trim()}"`;
}

/** Cloud only: Gemini writes a fully custom, self-contained HTML app. */
export const HTML_SYSTEM = `You write one self-contained mobile-first HTML file for a small app.
Hard rules:
- Output ONLY the HTML document, starting with <!doctype html>.
- No external resources: no <script src>, no CDN, no fonts, no images from URLs, no fetch/XMLHttpRequest/WebSocket.
- Inline all JS. A design system stylesheet is already loaded (light and dark mode); use its classes instead of writing your own theme:
  layout .vm-stack .vm-row · surfaces .vm-hero .vm-card · text .vm-title .vm-headline .vm-muted .vm-overline
  forms .vm-label .vm-input · buttons .vm-btn .vm-btn-secondary .vm-btn-block · .vm-chip (toggle aria-pressed) · AI output .vm-result · .vm-badge .vm-empty .vm-spinner
  Colors come from CSS variables: var(--vm-accent) var(--vm-accent-soft) var(--vm-surface) var(--vm-text) var(--vm-muted) var(--vm-border).
- Only add small extra CSS for layout specific to this app. Never hard-code colors.
- Structure: a .vm-hero with the app name and one-line purpose, the main form in a .vm-card, primary action as .vm-btn.vm-btn-block, results in .vm-result, saved items as a list of .vm-card, an empty state with .vm-empty.
- Show a .vm-spinner and disable the button while vonmini.ai is running, and show friendly error text if it fails. Must work at 360px wide.
- For AI features call: await vonmini.ai(promptString) -> string. It runs on a small on-device model, so ask for short outputs and keep prompts simple.
- Voice (all on the device, so it works offline):
  await vonmini.listen() -> string: listens to the user once and returns what they said ('' if nothing).
  await vonmini.speak(text): says text out loud; await vonmini.stopSpeaking().
  await vonmini.converse(persona, history) -> string: history is [{role:'user'|'assistant', text}] ending with the user's turn; the AI replies in the role described by persona and the reply is spoken aloud as it is written.
  For practice/rehearsal/role-play apps, build a voice conversation: a big round mic button that calls listen() then converse(), a transcript of turns as chat bubbles, a "hands-free" toggle that listens again after each reply, a stop button, and a text box to type instead of speaking. Show the state (Listening / Thinking / Speaking).
- For persistence call: await vonmini.store.get(key) -> any|null and await vonmini.store.set(key, value).
- Never use localStorage, cookies or alert().`;

export function htmlPrompt(request: string, specJson?: string) {
  return specJson
    ? `Build a richer custom version of this app. Keep its purpose and features, improve layout and interactions.\nApp JSON:\n${specJson}\nUser's original request: "${request}"`
    : `Build this app: "${request.trim()}"`;
}

/** Chat about one app: decide whether the user wants a change or an answer. */
export const INTENT_SYSTEM =
  'Classify a message a user sent about their app. Reply with ONLY JSON: {"intent":"change"} if they want the app modified (add, remove, rename, reword, restyle, improve), or {"intent":"question"} if they are asking or chatting.';

export const CHAT_SYSTEM = `You help a user understand and improve a small app they built. The app is described by JSON:
input = text field, choice = pick one, ai = button that sends its prompt (with {field} values) to a small on-device AI, save = stores an entry, history = past entries.
Answer in 1-3 short, friendly sentences. Do not show JSON. When useful, suggest one concrete change they could ask for.`;

export function chatPrompt(specJson: string, history: { role: string; text: string }[], message: string) {
  const convo = history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');
  return `App JSON:\n${specJson}\n\n${convo ? `${convo}\n` : ''}User: ${message.trim()}\nAssistant:`;
}

export const ACTION_SYSTEM =
  'You are a helpful assistant inside a small personal app. Answer briefly and directly. Plain text only, no markdown headings.';
