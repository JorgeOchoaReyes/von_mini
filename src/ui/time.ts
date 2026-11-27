/** Short times for chat messages, so how long each reply took is easy to follow. */

/** "8:11 PM" today, or "Nov 26, 8:11 PM" on another day. */
export function clockTime(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/** "4s", "1m 42s". */
export function duration(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
}

/** For a reply: its time and how long it took after the message it answers. */
export function replyTime(at: number, askedAt?: number): string {
  return askedAt && at >= askedAt ? `${clockTime(at)} · took ${duration(at - askedAt)}` : clockTime(at);
}
