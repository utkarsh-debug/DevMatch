'use server';

import { requireUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { toObjectId } from '@/lib/discussion';
import { redirectFlash } from '@/lib/flash';
import { comments, ObjectId } from '@/lib/mongo';
import { issueDetail } from '@/lib/queries';

const back = (issueId: number) => `/issues/${issueId}#discussion`;
const clean = (fd: FormData) => String(fd.get('body') ?? '').trim();

export async function addCommentAction(issueId: number, fd: FormData): Promise<void> {
  const user = await requireUser();
  const body = clean(fd);
  if (!body || body.length > 2000) redirectFlash(back(issueId), 'A comment must be 1–2000 characters.', 'error');
  if (!(await issueDetail(issueId))) redirectFlash('/issues', 'That issue no longer exists.', 'error');
  try {
    await (
      await comments()
    ).insertOne({
      _id: new ObjectId(),
      issueId,
      authorId: user.id,
      authorName: user.name,
      authorRole: user.role,
      body,
      createdAt: new Date(),
      likes: [],
      replies: [],
    });
  } catch (e) {
    console.error('[comments] insert failed', (e as Error).message);
    redirectFlash(back(issueId), 'The discussion service is unavailable right now. Please try again.', 'error');
  }
  await logActivity(user, 'comment', { issueId });
  redirectFlash(back(issueId), 'Comment posted.');
}

export async function addReplyAction(issueId: number, commentId: string, fd: FormData): Promise<void> {
  const user = await requireUser();
  const body = clean(fd);
  const _id = toObjectId(commentId);
  if (!_id || !body || body.length > 2000) redirectFlash(back(issueId), 'A reply must be 1–2000 characters.', 'error');
  try {
    const res = await (
      await comments()
    ).updateOne(
      { _id, issueId },
      // $push appends to the embedded replies array in one atomic document update
      {
        $push: {
          replies: {
            _id: new ObjectId(),
            authorId: user.id,
            authorName: user.name,
            authorRole: user.role,
            body,
            createdAt: new Date(),
          },
        },
      },
    );
    if (res.matchedCount === 0) redirectFlash(back(issueId), 'That comment no longer exists.', 'error');
  } catch (e) {
    if ((e as Error).message?.includes('NEXT_REDIRECT') || (e as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw e;
    redirectFlash(back(issueId), 'The discussion service is unavailable right now.', 'error');
  }
  await logActivity(user, 'reply', { issueId });
  redirectFlash(back(issueId), 'Reply posted.');
}

export async function toggleLikeAction(issueId: number, commentId: string): Promise<void> {
  const user = await requireUser();
  const _id = toObjectId(commentId);
  if (!_id) redirectFlash(back(issueId), 'Unknown comment.', 'error');
  const col = await comments();
  // un-like if the user is already in the set, otherwise add them ($addToSet never duplicates)
  const removed = await col.updateOne({ _id, issueId, likes: user.id }, { $pull: { likes: user.id } });
  if (removed.matchedCount === 0) await col.updateOne({ _id, issueId }, { $addToSet: { likes: user.id } });
  redirectFlash(back(issueId), removed.matchedCount ? 'Like removed.' : 'Liked.', 'info');
}

export async function deleteCommentAction(issueId: number, commentId: string): Promise<void> {
  const user = await requireUser();
  const _id = toObjectId(commentId);
  if (!_id) redirectFlash(back(issueId), 'Unknown comment.', 'error');
  const issue = await issueDetail(issueId);
  const isOwner = !!issue && issue.maintainer_id === user.id;
  // authors can delete their own comments; the project's maintainer can moderate any comment
  const filter = isOwner ? { _id, issueId } : { _id, issueId, authorId: user.id };
  const res = await (await comments()).deleteOne(filter);
  if (res.deletedCount) await logActivity(user, 'comment_deleted', { issueId });
  redirectFlash(
    back(issueId),
    res.deletedCount ? 'Comment deleted.' : 'You can only delete your own comments.',
    res.deletedCount ? 'success' : 'error',
  );
}
