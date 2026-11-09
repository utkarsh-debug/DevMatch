import type { Metadata } from 'next';
import { deleteNotificationAction, markAllReadAction, markReadAction } from '@/app/actions/notifications';
import { requireUser } from '@/lib/auth';
import { ago } from '@/lib/format';
import { notificationsOf } from '@/lib/queries';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await notificationsOf(user.id);
  const unread = items.filter((n) => !n.read_status).length;
  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}>
        <h1>Notifications</h1>
        {unread > 0 && (
          <form action={markAllReadAction}>
            <button className="btn small">Mark all as read</button>
          </form>
        )}
      </div>
      {items.length === 0 && <div className="card empty">You&apos;re all caught up.</div>}
      {items.map((n) => (
        <div className={`card notif ${n.read_status ? '' : 'unread'}`} key={n.id}>
          <div>
            <div>{n.message}</div>
            <div className="when">{ago(n.created_at)}</div>
          </div>
          <div className="row">
            {!n.read_status && (
              <form action={markReadAction.bind(null, n.id)}>
                <button className="btn small">Mark read</button>
              </form>
            )}
            <form action={deleteNotificationAction.bind(null, n.id)}>
              <button className="btn small danger" aria-label="Delete notification">
                Delete
              </button>
            </form>
          </div>
        </div>
      ))}
    </>
  );
}
