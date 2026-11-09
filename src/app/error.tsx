'use client';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card narrow" style={{ textAlign: 'center' }}>
      <h1>Something went wrong</h1>
      <p className="muted">
        {process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error happened. Check that PostgreSQL and MongoDB are running.'}
      </p>
      <button className="btn" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
