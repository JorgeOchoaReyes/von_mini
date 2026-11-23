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
- save {label}: saves inputs and AI results
- history {label}: lists saved entries
Rules: 3-9 components. ids are lowercase_snake. Every ai prompt uses at least one {input_id} and asks for a short answer.
The AI only sees what the user typed: no internet, no images, no live data.`;

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
- Inline all CSS and JS. Look polished: system font, generous spacing, rounded cards, works at 360px wide, supports dark mode via prefers-color-scheme.
- For AI features call: await vonmini.ai(promptString) -> string. It runs on a small on-device model, so ask for short outputs and keep prompts simple.
- For persistence call: await vonmini.store.get(key) -> any|null and await vonmini.store.set(key, value).
- Never use localStorage, cookies or alert().`;

export function htmlPrompt(request: string, specJson?: string) {
  return specJson
    ? `Build a richer custom version of this app. Keep its purpose and features, improve layout and interactions.\nApp JSON:\n${specJson}\nUser's original request: "${request}"`
    : `Build this app: "${request.trim()}"`;
}

export const ACTION_SYSTEM =
  'You are a helpful assistant inside a small personal app. Answer briefly and directly. Plain text only, no markdown headings.';
