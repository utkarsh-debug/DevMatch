'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * One-shot message banner. Server actions redirect to  <page>?flash=...&kind=...;
 * this reads it, shows it, and strips it from the address bar.
 */
export function Flash() {
  const params = useSearchParams();
  const path = usePathname();
  const [msg, setMsg] = useState<{ text: string; kind: string } | null>(null);

  // leaving the page clears the banner (declared first so a new flash on the next page wins)
  useEffect(() => setMsg(null), [path]);

  useEffect(() => {
    const text = params.get('flash');
    if (!text) return;
    setMsg({ text, kind: params.get('kind') ?? 'info' });
    const u = new URL(window.location.href);
    u.searchParams.delete('flash');
    u.searchParams.delete('kind');
    window.history.replaceState(null, '', u.pathname + u.search + u.hash);
  }, [params]);

  if (!msg) return null;
  return (
    <div className={`flash ${msg.kind}`} role="status">
      {msg.text}
    </div>
  );
}
