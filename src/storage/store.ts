/**
 * On-device storage. AsyncStorage is backed by SQLite in the Android app's private storage
 * and by localStorage on web, so apps and their data never need the network.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { InferenceSource } from '../ai/types';
import type { AppSpec } from '../spec/types';
import { STARTERS } from '../spec/starters';

export interface SavedApp {
  id: string;
  request: string;
  spec: AppSpec;
  /** Custom HTML version written by Gemini in the cloud (optional). */
  html?: string;
  builtWith: InferenceSource | 'starter';
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
  undone?: boolean;
}

const APPS_KEY = 'vm:apps';
const entriesKey = (appId: string) => `vm:entries:${appId}`;
const kvKey = (appId: string) => `vm:kv:${appId}`;
const chatKey = (appId: string) => `vm:chat:${appId}`;

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
  await AsyncStorage.multiRemove([entriesKey(id), kvKey(id), chatKey(id)]);
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

export async function addEntry(appId: string, values: Record<string, string>): Promise<Entry[]> {
  const entries = await listEntries(appId);
  const next = [{ id: newId(), at: Date.now(), values }, ...entries].slice(0, 500);
  await writeJson(entriesKey(appId), next);
  return next;
}

export async function deleteEntry(appId: string, entryId: string): Promise<Entry[]> {
  const next = (await listEntries(appId)).filter((e) => e.id !== entryId);
  await writeJson(entriesKey(appId), next);
  return next;
}

/** Key-value store exposed to custom HTML apps through the bridge. */
export async function kvGet(appId: string, key: string): Promise<unknown> {
  const kv = await readJson<Record<string, unknown>>(kvKey(appId), {});
  return kv[key] ?? null;
}

export async function kvSet(appId: string, key: string, value: unknown): Promise<void> {
  const kv = await readJson<Record<string, unknown>>(kvKey(appId), {});
  kv[String(key).slice(0, 100)] = value;
  const raw = JSON.stringify(kv);
  if (raw.length > 1_000_000) throw new Error('App storage is full (1 MB limit).');
  await AsyncStorage.setItem(kvKey(appId), raw);
}
