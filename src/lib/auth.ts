/**
 * Session handling: a signed JWT (HS256, via `jose`) in an HttpOnly cookie.
 * Passwords are hashed with bcrypt (see actions/auth.ts).
 */
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { q1 } from '@/lib/db';
import type { Role, User } from '@/lib/types';

export const SESSION_COOKIE = 'dm_session';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET ?? 'dev-only-secret-change-me-before-deploying-0123456789';
  return new TextEncoder().encode(s);
}

export async function createSession(userId: number): Promise<void> {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.AUTH_COOKIE_SECURE === 'true',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Current user (or null). Memoised per request. Suspended accounts are treated as logged out. */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const uid = Number(payload.uid);
    if (!uid) return null;
    const u = await q1<User>(
      'SELECT id, name, email, role, bio, account_status FROM users WHERE id = $1',
      [uid],
    );
    return u && u.account_status === 'active' ? u : null;
  } catch {
    return null;
  }
});

/** Page guard: must be logged in (and optionally have a given role). */
export async function requireUser(role?: Role): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (role && user.role !== role) {
    redirect(`/?flash=${encodeURIComponent("You don't have access to that page.")}&kind=error`);
  }
  return user;
}
