/**
 * On-device storage. AsyncStorage is backed by SQLite in the Android app's private storage
 * and by localStorage on web, so apps and their data never need the network.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import type { InferenceSource } from '../ai/types';
import type { AppSpec } from '../spec/types';
import { STARTERS } from '../spec/starters';

export interface SavedApp {
  id: string;
  request: string;
  spec: AppSpec;
  /** Custom HTML version written by Gemini in the cloud (optional). */
  html?: string;
  /** The design's `code` brief that `html` was written from, so a changed brief writes it again. */
  htmlFor?: string;
  builtWith: InferenceSource | 'starter';
  /** Where this app's own AI runs: auto (hybrid, default), device (Gemini Nano only) or cloud. */
  aiMode?: 'auto' | 'device' | 'cloud';
  /** Firestore id of this app's shared design, once the user has shared it. */
  shareId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Entry {
  id: string;
  at: number;
  values: Record<string, string>;
}

export interface ChatMessage {
  id: string;
  at: number;
  role: 'user' | 'assistant';
  text: string;
  /** assistant only: what the reply did. */
  kind?: 'answer' | 'edit' | 'undo' | 'error';
  source?: InferenceSource;
  /** For edits: the spec before the change, so it can be undone. */
  prevSpec?: AppSpec;
  /** For an edit: the app right after it, so undo can tell whether anything changed since. */
  nextSpec?: AppSpec;
  undone?: boolean;
  /** For a change to an app's code: how writing it went ("1m 42s · 312 lines"). */
  stats?: string;
}

const APPS_KEY = 'vm:apps';
const entriesKey = (appId: string) => `vm:entries:${appId}`;
const kvKey = (appId: string) => `vm:kv:${appId}`;
const chatKey = (appId: string) => `vm:chat:${appId}`;
const versionsKey = (appId: string) => `vm:versions:${appId}`;

/** How many spec snapshots to keep per app. Enough to undo a session's worth of edits. */
const MAX_VERSIONS = 30;

/** A saved snapshot of an app's spec, so any change can be reviewed and reversed. */
export interface Version {
  id: string;
  at: number;
  spec: AppSpec;
  /** Plain-words summary of what this version changed, computed locally by `describeChanges`. */
  changes: string[];
  /** How the version came about. */
  origin: 'build' | 'chat' | 'manual' | 'restore';
  source: InferenceSource | 'starter';
  /** The app's code, when this version was its code version (so a rollback needn't rewrite it). */
  html?: string;
}

/**
 * Whether an app shows its code version. An app is one thing at a time: its blocks, or the code
 * written for its current design (`spec.code`). Apps made custom before design briefs existed have
 * code without a brief, and show it until they're changed back.
 */
export function showsCode(app: Pick<SavedApp, 'html' | 'htmlFor' | 'spec'>): boolean {
  if (!app.html) return false;
  if (app.spec.code) return app.htmlFor === app.spec.code;
  return app.htmlFor === undefined;
}

/** htmlFor for code that's kept (for history) but not shown. */
const SHELVED = '-';

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
const writeJson = (key: string, value: unknown) => AsyncStorage.setItem(key, JSON.stringify(value));

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function listApps(): Promise<SavedApp[]> {
  const mine = await readJson<SavedApp[]>(APPS_KEY, []);
  const starterIds = new Set(mine.map((a) => a.id));
  const starters = STARTERS.filter((s) => !starterIds.has(s.id));
  return [...mine.sort((a, b) => b.updatedAt - a.updatedAt), ...starters];
}

export async function getApp(id: string): Promise<SavedApp | undefined> {
  return (await listApps()).find((a) => a.id === id);
}

export async function saveApp(app: SavedApp): Promise<void> {
  const mine = await readJson<SavedApp[]>(APPS_KEY, []);
  const next = mine.filter((a) => a.id !== app.id);
  next.push({ ...app, updatedAt: Date.now() });
  await writeJson(APPS_KEY, next);
}

export async function deleteApp(id: string): Promise<void> {
  const mine = await readJson<SavedApp[]>(APPS_KEY, []);
  await writeJson(
    APPS_KEY,
    mine.filter((a) => a.id !== id),
  );
  // A save still waiting to be written must not bring the app's data back.
  clearTimeout(kvTimers.get(id));
  kvTimers.delete(id);
  kvCache.delete(id);
  await AsyncStorage.multiRemove([entriesKey(id), kvKey(id), chatKey(id), versionsKey(id)]);
}

/** Newest first. */
export const listVersions = (appId: string) => readJson<Version[]>(versionsKey(appId), []);

/**
 * Records a snapshot of the app's spec. Called after every change — a build, a chat edit, a
 * manual tweak — so the version list is a complete, restorable timeline of the app's design.
 */
export async function pushVersion(
  appId: string,
  spec: AppSpec,
  changes: string[],
  origin: Version['origin'],
  source: Version['source'],
  /**
   * The spec as it was before this change. When the app has no history yet (a starter, or an app
   * made before version history existed) it is recorded first, so the original can be restored.
   */
  prev?: AppSpec,
  /** The code, when this version is a code version. */
  html?: string,
): Promise<void> {
  let all = await listVersions(appId);
  if (!all.length && prev && JSON.stringify(prev) !== JSON.stringify(spec)) {
    all = [{ id: newId(), at: Date.now() - 1, spec: prev, changes: ['The original version.'], origin: 'build', source }];
  }
  // Skip a snapshot identical to the newest one (e.g. a no-op edit) to keep the list meaningful.
  if (all[0] && JSON.stringify(all[0].spec) === JSON.stringify(spec) && all[0].html === html) return;
  const next = [{ id: newId(), at: Date.now(), spec, changes, origin, source, ...(html ? { html } : {}) }, ...all].slice(0, MAX_VERSIONS);
  await writeJson(versionsKey(appId), next);
}

/** Restores a spec from the version list, recording the restore itself as a new version. */
export async function restoreVersion(appId: string, versionId: string): Promise<AppSpec | undefined> {
  const version = (await listVersions(appId)).find((v) => v.id === versionId);
  const app = await getApp(appId);
  if (!version || !app) return undefined;
  // A code version brings its code back; a blocks version shelves any code (kept, not shown).
  const next: SavedApp = version.html
    ? { ...app, spec: version.spec, html: version.html, htmlFor: version.spec.code }
    : { ...app, spec: version.spec, ...(app.html ? { htmlFor: SHELVED } : {}) };
  await saveApp(next);
  await pushVersion(appId, version.spec, [`Restored the version from ${new Date(version.at).toLocaleString()}.`], 'restore', app.builtWith, undefined, version.html);
  return version.spec;
}

export const listMessages = (appId: string) => readJson<ChatMessage[]>(chatKey(appId), []);

export async function appendMessage(appId: string, msg: Omit<ChatMessage, 'id' | 'at'>): Promise<ChatMessage> {
  const full: ChatMessage = { ...msg, id: newId(), at: Date.now() };
  const all = await listMessages(appId);
  // Keep the thread bounded; snapshots for undo make old messages heavy.
  await writeJson(chatKey(appId), [...all, full].slice(-200));
  return full;
}

export async function updateMessage(appId: string, id: string, patch: Partial<ChatMessage>): Promise<void> {
  const all = await listMessages(appId);
  await writeJson(
    chatKey(appId),
    all.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  );
}

export const listEntries = (appId: string) => readJson<Entry[]>(entriesKey(appId), []);

// Entry writes for one app run one after another, so a quick save and delete (or a game ending
// mid-save) never read the same list and drop or bring back an entry.
const entryQueues = new Map<string, Promise<unknown>>();
function changeEntries(appId: string, change: (entries: Entry[]) => Entry[]): Promise<Entry[]> {
  const run = (entryQueues.get(appId) ?? Promise.resolve()).then(async () => {
    const next = change(await listEntries(appId));
    await writeJson(entriesKey(appId), next);
    return next;
  });
  entryQueues.set(appId, run.catch(() => undefined));
  return run;
}

export function addEntry(appId: string, values: Record<string, string>): Promise<Entry[]> {
  return changeEntries(appId, (entries) => [{ id: newId(), at: Date.now(), values }, ...entries].slice(0, 500));
}

export function deleteEntry(appId: string, entryId: string): Promise<Entry[]> {
  return changeEntries(appId, (entries) => entries.filter((e) => e.id !== entryId));
}

/** Key-value store exposed to custom HTML apps through the bridge. */
/**
 * Each app's own saved data (vonmini.store), kept in memory once read and written to disk shortly
 * after a change, batched: a game saving often must not re-read and re-write its whole store each
 * time.
 */
const kvCache = new Map<string, Promise<Record<string, unknown>>>();
const kvTimers = new Map<string, ReturnType<typeof setTimeout>>();
const kvStore = (appId: string) => {
  let kv = kvCache.get(appId);
  if (!kv) {
    kv = readJson<Record<string, unknown>>(kvKey(appId), {});
    kvCache.set(appId, kv);
  }
  return kv;
};

export async function kvGet(appId: string, key: string): Promise<unknown> {
  const kv = await kvStore(appId);
  return kv[key] ?? null;
}

export async function kvSet(appId: string, key: string, value: unknown): Promise<void> {
  const kv = await kvStore(appId);
  const k = String(key).slice(0, 100);
  const before = kv[k];
  kv[k] = value;
  const raw = JSON.stringify(kv);
  if (raw.length > 1_000_000) {
    kv[k] = before;
    throw new Error('App storage is full (1 MB limit).');
  }
  // Soon, not on every call: a burst of saves is written once.
  if (!kvTimers.has(appId)) kvTimers.set(appId, setTimeout(() => writeKv(appId), 200));
}

function writeKv(appId: string) {
  clearTimeout(kvTimers.get(appId));
  kvTimers.delete(appId);
  const kv = kvCache.get(appId);
  if (kv) void kv.then((v) => AsyncStorage.setItem(kvKey(appId), JSON.stringify(v))).catch(() => undefined);
}

/** Writes every app's pending saves now (von mini going to the background or closing). */
export function flushAppData() {
  for (const appId of [...kvTimers.keys()]) writeKv(appId);
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', flushAppData);
}
AppState.addEventListener('change', (s) => {
  if (s !== 'active') flushAppData();
});
