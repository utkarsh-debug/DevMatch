'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/app/actions/auth';
import { NavLink } from '@/components/NavLink';

export interface Me {
  id: number;
  name: string;
  role: 'contributor' | 'maintainer';
}

/**
 * Site header. Rendered on the server with the current user, then refreshed from /api/me after every
 * client-side navigation (layouts are not re-rendered by the App Router, so the unread badge would go stale).
 */
export function Header({ user, unread }: { user: Me | null; unread: number }) {
  const path = usePathname();
  const [live, setLive] = useState<{ user: Me | null; unread: number } | null>(null);
  const first = useRef(true);

  // fresh server props (after a server action revalidated the layout) beat older client data
  useEffect(() => setLive(null), [user?.id, user?.name, unread]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let cancelled = false;
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => !cancelled && setLive(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path]);

  const me = live ? live.user : user;
  const count = live ? live.unread : unread;

  return (
    <header className="site-header">
      <div className="wrap">
        <Link className="brand" href="/">
          <span className="mark" />
          DevMatch
        </Link>
        {me ? (
          <>
            <nav className="main">
              {me.role === 'contributor' ? (
                <>
                  <NavLink href="/feed">My feed</NavLink>
                  <NavLink href="/issues">All issues</NavLink>
                  <NavLink href="/applications">Applications</NavLink>
                </>
              ) : (
                <>
                  <NavLink href="/dashboard">Dashboard</NavLink>
                  <NavLink href="/issues">All issues</NavLink>
                  <NavLink href="/projects/new">New project</NavLink>
                </>
              )}
              <NavLink href="/activity">Activity</NavLink>
              <NavLink href="/insights">DB insights</NavLink>
            </nav>
            <div className="header-right">
              <Link className="bell" href="/notifications">
                Notifications{count > 0 && <span className="badge">{count}</span>}
              </Link>
              <Link className="who" href="/profile">
                <strong>{me.name}</strong> · {me.role}
              </Link>
              <form action={logoutAction} style={{ display: 'inline' }}>
                <button className="btn small">Log out</button>
              </form>
            </div>
          </>
        ) : (
          <>
            <nav className="main" />
            <div className="header-right">
              <Link className="btn small" href="/login">
                Log in
              </Link>
              <Link className="btn small primary" href="/register">
                Sign up
              </Link>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
