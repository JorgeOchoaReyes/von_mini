/**
 * Small, exact rules about what a person asked for, kept free of app imports so they can be tested
 * on their own.
 */

/** Requests too vague to justify writing custom code ("app", "something"). */
export function isVagueRequest(request: string): boolean {
  return /^\s*(?:an? |my |some )?(?:apps?|something|anything|idea|test|hi|hello|help|stuff)\W*$/i.test(request);
}

/** "show 30 days on the chart", "chart the last month": how far back a chart should look. */
export function chartDaysAsked(message: string): number | null {
  if (!/\b(chart|graph)\b/i.test(message)) return null;
  const n = message.match(/\b(\d{1,3})\s*days?\b/i);
  if (n) return Number(n[1]);
  if (/\b(last|past|a|one|whole) month\b|\bmonthly\b/i.test(message)) return 30;
  if (/\b(two|2) weeks\b/i.test(message)) return 14;
  if (/\b(last|past|a|one) week\b|\bweekly\b/i.test(message)) return 7;
  return null;
}
