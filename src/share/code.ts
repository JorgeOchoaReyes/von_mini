/**
 * Share codes: a whole app design packed into a short, URL-safe string, so an app can travel in a
 * QR code or a link with no server and no account. Only the design is packed (never entries,
 * chats or anything typed into the app), and whoever receives it validates it like model output.
 *
 *   code = "VM1." + base64url(deflate(JSON {v, s: spec, r: request}))
 *
 * The same code goes in a link (…/s/VM1.xxxx), so one route opens both these and older links to
 * designs published in Firestore.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

import type { AppSpec } from '../spec/types';
import { sanitizeSpec } from '../spec/validate';

export const CODE_PREFIX = 'VM1.';

/** Codes longer than this are refused: no real app is this big, and it caps what we inflate. */
const MAX_CODE = 8000;
/** The biggest code a QR code holds reliably (byte mode, low error correction, version 40 is 2953). */
export const MAX_QR_CODE = 2300;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

function fromBase64Url(s: string): Uint8Array {
  const vals = [...s].map((ch) => {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('bad character');
    return v;
  });
  const out = new Uint8Array(Math.floor((vals.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < vals.length; i += 4) {
    const n = (vals[i] << 18) | ((vals[i + 1] ?? 0) << 12) | ((vals[i + 2] ?? 0) << 6) | (vals[i + 3] ?? 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// Values the receiver's validator puts back anyway, so they needn't travel (a smaller QR code).
const DEFAULTS: Record<string, unknown> = { multiline: false, speed: 'normal', range: 'today' };

/** The design with everything the validator restores left out. */
function compact(spec: AppSpec): unknown {
  return {
    ...spec,
    components: spec.components.map((c) =>
      Object.fromEntries(Object.entries(c).filter(([k, v]) => v !== undefined && v !== false && DEFAULTS[k] !== v)),
    ),
  };
}

/**
 * Packs an app's design into a share code. The request it was built from is left out by default:
 * it only labels the copy, and every character makes the QR code denser.
 */
export function encodeApp(spec: AppSpec, request = '', withRequest = false): string {
  const json = JSON.stringify({ v: 1, s: compact(spec), r: withRequest ? request.slice(0, 160) || undefined : undefined });
  return CODE_PREFIX + toBase64Url(deflateSync(strToU8(json), { level: 9 }));
}

/** Finds a share code in anything pasted: a bare code, a link, or a whole shared message. */
export function findCode(text: string): string | null {
  const m = text.match(/VM1\.[A-Za-z0-9_-]+/);
  return m ? m[0] : null;
}

/** Unpacks a share code into a validated design. Throws a readable error if it isn't one. */
export function decodeApp(text: string): { spec: AppSpec; request: string } {
  const code = findCode(text);
  if (!code) throw new Error('That isn’t a von mini share code or link.');
  if (code.length > MAX_CODE) throw new Error('That share code is too long to be a von mini app.');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(inflateSync(fromBase64Url(code.slice(CODE_PREFIX.length)))));
  } catch {
    throw new Error('That share code is incomplete or damaged. Ask for the link again.');
  }
  const d = raw as { v?: unknown; s?: unknown; r?: unknown };
  if (d?.v !== 1 || !d.s) throw new Error('That share code is from a newer version of von mini. Update the app and try again.');
  return { spec: sanitizeSpec(d.s), request: typeof d.r === 'string' ? d.r : '' };
}
