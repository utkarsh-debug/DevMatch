import './globals.css';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Flash } from '@/components/Flash';
import { getSessionUser } from '@/lib/auth';
import { backendName } from '@/lib/embedder';
import { unreadCount } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'DevMatch', template: '%s · DevMatch' },
  description: 'Semantic contributor-to-issue matching for open-source projects.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const unread = user ? await unreadCount(user.id) : 0;
  const backend = await backendName();
  return (
    <html lang="en">
      <body>
        <Header user={user ? { id: user.id, name: user.name, role: user.role } : null} unread={unread} />
        <main className="wrap">
          <Suspense fallback={null}>
            <Flash />
          </Suspense>
          {children}
        </main>
        <footer className="footer">
          <div className="wrap">
            DevMatch · Next.js + PostgreSQL/pgvector + MongoDB · embedding backend:{' '}
            <span className="mono">{backend}</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
