/**
 * The Chat tab's conversations, saved on the device as they happen (no save button). Newest
 * first; capped so storage stays small.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { InferenceSource } from '../ai/types';
import type { Turn } from '../voice/cascade';

export interface ChatTurn extends Turn {
  at: number;
  /** Where the reply ran, for the small source badge. */
  source?: InferenceSource;
  /** The reply failed: `text` is the error to show. */
  error?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
}

const KEY = 'vm:conversations';
const MAX = 100;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Reads the stored list. Throws if it can't be read, so a write never replaces chats it didn't see. */
async function read(): Promise<Conversation[]> {
  const raw = await AsyncStorage.getItem(KEY);
  const list = raw ? (JSON.parse(raw) as Conversation[]) : [];
  return Array.isArray(list) ? list.sort((a, b) => b.updatedAt - a.updatedAt) : [];
}

// Writes run one after another, so two quick saves never interleave and drop each other.
let queue: Promise<unknown> = Promise.resolve();
function write(change: (list: Conversation[]) => Conversation[]): Promise<void> {
  const next = queue.then(async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(change(await read())));
  });
  queue = next.catch(() => undefined);
  return next;
}

export async function listConversations(): Promise<Conversation[]> {
  try {
    return await read();
  } catch {
    return [];
  }
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  return (await listConversations()).find((c) => c.id === id);
}

export function newConversation(): Conversation {
  const now = Date.now();
  return { id: newId(), title: 'New chat', createdAt: now, updatedAt: now, turns: [] };
}

/** A title from the first thing the user said. */
export function titleFor(turns: ChatTurn[]): string {
  const first = turns.find((t) => t.role === 'user')?.text.replace(/\s+/g, ' ').trim();
  if (!first) return 'New chat';
  return first.length > 42 ? `${first.slice(0, 40).trimEnd()}…` : first;
}

/** Saves a conversation (empty ones aren't kept). */
export function saveConversation(c: Conversation): Promise<void> {
  return write((all) => {
    const list = all.filter((x) => x.id !== c.id);
    if (c.turns.some((t) => t.role === 'user')) list.unshift({ ...c, title: titleFor(c.turns), updatedAt: Date.now() });
    return list.slice(0, MAX);
  });
}

export function deleteConversation(id: string): Promise<void> {
  return write((all) => all.filter((x) => x.id !== id));
}
