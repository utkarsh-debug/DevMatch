import { addCommentAction, addReplyAction, deleteCommentAction, toggleLikeAction } from '@/app/actions/comments';
import { ConfirmForm } from '@/components/ConfirmForm';
import { SubmitButton } from '@/components/SubmitButton';
import { Pill } from '@/components/ui';
import type { CommentView } from '@/lib/discussion';
import { ago } from '@/lib/format';
import type { User } from '@/lib/types';

/** Discussion thread for an issue. Data comes from MongoDB (comments with embedded replies). */
export function Thread({
  issueId,
  thread,
  user,
  isOwner,
}: {
  issueId: number;
  thread: CommentView[] | null;
  user: User;
  isOwner: boolean;
}) {
  return (
    <section id="discussion" className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>
          Discussion{thread ? ` (${thread.reduce((n, c) => n + 1 + c.replies.length, 0)})` : ''}
        </h2>
        <span className="tech-note">stored in MongoDB · replies embedded</span>
      </div>

      {thread === null ? (
        <p className="muted">The discussion service (MongoDB) is not reachable right now. The rest of the page still works.</p>
      ) : (
        <>
          <form action={addCommentAction.bind(null, issueId)} className="stack" style={{ marginBottom: 10 }}>
            <label htmlFor="new-comment" className="small muted" style={{ fontWeight: 500 }}>
              Ask a question or share context with the maintainer and other contributors
            </label>
            <textarea id="new-comment" name="body" style={{ minHeight: 80 }} maxLength={2000} required placeholder="Write a comment…" />
            <SubmitButton>Post comment</SubmitButton>
          </form>

          {thread.length === 0 && <p className="muted small">No comments yet — be the first.</p>}

          {thread.map((c) => {
            const liked = c.likes.includes(user.id);
            const canDelete = isOwner || c.authorId === user.id;
            return (
              <article className="comment" key={c.id} data-testid="comment">
                <div className="head">
                  <b>{c.authorName}</b>
                  <Pill value={c.authorRole} />
                  <span className="muted small">{ago(c.createdAt)}</span>
                </div>
                <div className="body">{c.body}</div>
                <div className="tools">
                  <form action={toggleLikeAction.bind(null, issueId, c.id)} style={{ display: 'inline' }}>
                    <SubmitButton className={`btn small ${liked ? 'liked' : ''}`}>
                      {liked ? '♥ Liked' : '♡ Like'} · {c.likes.length}
                    </SubmitButton>
                  </form>
                  {canDelete && (
                    <ConfirmForm action={deleteCommentAction.bind(null, issueId, c.id)} message="Delete this comment and its replies?">
                      <button className="btn small danger">Delete</button>
                    </ConfirmForm>
                  )}
                </div>

                {c.replies.length > 0 && (
                  <div className="replies">
                    {c.replies.map((r) => (
                      <div className="reply" key={r.id}>
                        <div className="head">
                          <b>{r.authorName}</b>
                          <Pill value={r.authorRole} />
                          <span className="muted small">{ago(r.createdAt)}</span>
                        </div>
                        <div className="body" style={{ marginBottom: 0 }}>
                          {r.body}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <details style={{ marginTop: 8 }}>
                  <summary className="btn small">Reply</summary>
                  <form action={addReplyAction.bind(null, issueId, c.id)} className="stack">
                    <textarea name="body" style={{ minHeight: 64 }} maxLength={2000} required placeholder="Write a reply…" />
                    <SubmitButton>Send reply</SubmitButton>
                  </form>
                </details>
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}
