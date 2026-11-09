/** "3m ago" style relative time. */
export function ago(dt: Date | string | null | undefined): string {
  if (!dt) return '';
  const s = Math.floor((Date.now() - new Date(dt).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** cosine similarity (0..1) -> integer percentage, or null when there is no score. */
export function pct(sim: number | null | undefined): number | null {
  if (sim === null || sim === undefined || Number.isNaN(Number(sim))) return null;
  return Math.round(Math.max(0, Math.min(1, Number(sim))) * 100);
}

export function label(s: string): string {
  return s.replaceAll('_', ' ');
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
