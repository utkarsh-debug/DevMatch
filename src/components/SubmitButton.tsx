'use client';

import { useFormStatus } from 'react-dom';
import type { ButtonHTMLAttributes } from 'react';

/** Submit button that disables itself while the surrounding <form action={...}> is running. */
export function SubmitButton({ className = 'btn primary', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-busy={pending} {...rest}>
      {children}
    </button>
  );
}
