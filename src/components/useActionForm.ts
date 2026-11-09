'use client';

import { startTransition, useActionState, type FormEvent } from 'react';
import type { FormState } from '@/lib/types';

/**
 * Wraps a server action that returns a FormState (validation error) or redirects on success.
 * Submitting through onSubmit — instead of <form action> — keeps whatever the user typed when
 * validation fails (React 19 would otherwise reset the form).
 */
export function useActionForm(action: (prev: FormState, fd: FormData) => Promise<FormState>) {
  const [state, dispatch, pending] = useActionState(action, undefined);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  return { state, onSubmit, pending };
}
