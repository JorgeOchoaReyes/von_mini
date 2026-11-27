/**
 * A code app's brief: what the app is, the recent chat for context, and the newest change on the
 * end. Its HTML is updated in place, so earlier changes are already in it; the brief keeps what
 * the app is plus only the latest ask, so the newest ask is never cut off and the brief always
 * differs (which is what starts the update).
 *
 * The recent chat is there so a follow-up makes sense to the code writer: "no, the legs too" or
 * "a bit darker" mean nothing without the message before it.
 */
const SECTIONS = /\n\nEarlier in this chat[^\n]*:\n|\n\nLatest change( #\d+)?: | Also: /;
const EARLIER = /\n\nEarlier in this chat[^\n]*:\n([\s\S]*?)(?=\n\nLatest change|$)/;

/** How many recent messages go along, and how much of each. */
const EARLIER_MESSAGES = 6;
const EARLIER_CHARS = 240;

export type ChatLine = { role: string; text: string };

/** What the app is, without the chat or the latest change. */
export const briefBase = (brief: string) => brief.split(SECTIONS)[0].trim();

/** The recent chat carried in the brief, if any. */
export const briefEarlier = (brief: string) => brief.match(EARLIER)?.[1]?.trim() || undefined;

export function withLatestChange(brief: string, message: string, earlier: ChatLine[] = []): string {
  const base = briefBase(brief).slice(0, 500);
  const n = Number(brief.match(/\n\nLatest change #(\d+):/)?.[1] ?? 0) + 1;
  const lines = earlier
    .filter((m) => m.text.trim())
    .slice(-EARLIER_MESSAGES)
    .map((m) => {
      const text = m.text.trim().replace(/\s+/g, ' ');
      return `${m.role === 'user' ? 'User' : 'von mini'}: ${text.length > EARLIER_CHARS ? `${text.slice(0, EARLIER_CHARS)}…` : text}`;
    });
  const chat = lines.length ? `\n\nEarlier in this chat (already done):\n${lines.join('\n')}` : '';
  return `${base}${chat}\n\nLatest change #${n}: ${message.trim().slice(0, 400)}`;
}
