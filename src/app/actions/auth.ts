'use server';

import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { q1, tx, pgCode, PG_UNIQUE } from '@/lib/db';
import { createSession, destroySession } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { flashUrl } from '@/lib/flash';
import { parseSkills, refreshUserEmbedding, saveUserSkills } from '@/lib/writes';
import type { FormState, Role } from '@/lib/types';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

export async function registerAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const name = str(fd, 'name');
  const email = str(fd, 'email').toLowerCase();
  const password = String(fd.get('password') ?? '');
  const role = (str(fd, 'role') || 'contributor') as Role;
  const bio = str(fd, 'bio');
  const skills = parseSkills(fd);
  const values = { name, email, role, bio, skills };

  const errors: string[] = [];
  if (!name) errors.push('Name is required.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('Enter a valid email address.');
  if (password.length < 6) errors.push('Password must be at least 6 characters.');
  if (role !== 'contributor' && role !== 'maintainer') errors.push('Choose a role.');
  if (role === 'contributor' && !bio && skills.length === 0)
    errors.push('Add a short bio or at least one skill so we can match you.');
  if (errors.length) return { error: errors.join(' '), values };

  const hash = await bcrypt.hash(password, 10);
  let uid: number;
  try {
    uid = await tx(async (c) => {
      const r = await c.query(
        `INSERT INTO users (name, email, password_hash, role, bio) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [name, email, hash, role, bio || null],
      );
      const id = r.rows[0].id as number;
      await saveUserSkills(c, id, skills);
      if (role === 'contributor') await refreshUserEmbedding(c, id); // bio + skills -> vector(384)
      return id;
    });
  } catch (e) {
    if (pgCode(e) === PG_UNIQUE) return { error: 'That email is already registered.', values };
    throw e;
  }
  await createSession(uid);
  await logActivity({ id: uid, name, role }, 'register', { meta: { skills: skills.length } });
  redirect(flashUrl(role === 'maintainer' ? '/dashboard' : '/feed', `Welcome to DevMatch, ${name}!`));
}

export async function loginAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const email = str(fd, 'email').toLowerCase();
  const password = String(fd.get('password') ?? '');
  const next = str(fd, 'next');
  const u = await q1<{ id: number; name: string; role: Role; password_hash: string; account_status: string }>(
    'SELECT id, name, role, password_hash, account_status FROM users WHERE email = $1',
    [email],
  );
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    return { error: 'Wrong email or password.', values: { email } };
  }
  if (u.account_status !== 'active') return { error: 'This account is suspended.', values: { email } };
  await createSession(u.id);
  await logActivity(u, 'login');
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : u.role === 'maintainer' ? '/dashboard' : '/feed');
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/');
}
