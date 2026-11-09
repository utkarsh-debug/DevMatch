import { redirect } from 'next/navigation';

export type FlashKind = 'success' | 'error' | 'info';

/** Build a URL carrying a one-shot message, shown by <Flash/> and then stripped from the address bar. */
export function flashUrl(path: string, message: string, kind: FlashKind = 'success'): string {
  const [base, ...rest] = path.split('#'); // the query string must come BEFORE any #fragment
  const hash = rest.length ? `#${rest.join('#')}` : '';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}flash=${encodeURIComponent(message)}&kind=${kind}${hash}`;
}

export function redirectFlash(path: string, message: string, kind: FlashKind = 'success'): never {
  redirect(flashUrl(path, message, kind));
}
