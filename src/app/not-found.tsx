import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card narrow" style={{ textAlign: 'center' }}>
      <h1>404</h1>
      <p className="muted">We couldn&apos;t find that page.</p>
      <Link className="btn" href="/">
        Go home
      </Link>
    </div>
  );
}
