'use client';

import type { ReactNode } from 'react';

/** A <form> that asks window.confirm() before submitting its (server) action. */
export function ConfirmForm({
  action,
  message,
  children,
  className = 'inline',
}: {
  action: (formData: FormData) => void | Promise<void>;
  message: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
