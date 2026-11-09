/** Helpers for Next.js 15 async route/search params. */
export type SP = Promise<Record<string, string | string[] | undefined>>;

export const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

/** Parse a positive integer route param, or return null. */
export function numId(v: string): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 2_147_483_647 ? n : null;
}
