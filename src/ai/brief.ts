/**
 * A code app's brief with the newest change on the end. Its HTML is updated in place, so earlier
 * changes are already in it; the brief keeps what the app is plus only the latest ask, so the
 * newest ask is never cut off and the brief always differs (which is what starts the update).
 */
export function withLatestChange(brief: string, message: string): string {
  const base = brief.split(/\n\nLatest change( #\d+)?: | Also: /)[0].slice(0, 500);
  const n = Number(brief.match(/\n\nLatest change #(\d+):/)?.[1] ?? 0) + 1;
  return `${base}\n\nLatest change #${n}: ${message.trim().slice(0, 400)}`;
}
