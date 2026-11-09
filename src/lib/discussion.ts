/**
 * Discussion threads on issues — stored in MongoDB.
 * A thread is the set of `comments` documents with the same issueId; each comment embeds its replies.
 */
import { comments, ObjectId } from '@/lib/mongo';

export interface ReplyView {
  id: string;
  authorId: number;
  authorName: string;
  authorRole: string;
  body: string;
  createdAt: Date;
}

export interface CommentView {
  id: string;
  authorId: number;
  authorName: string;
  authorRole: string;
  body: string;
  createdAt: Date;
  likes: number[];
  replies: ReplyView[];
}

/** All comments of an issue, newest first. */
export async function threadFor(issueId: number): Promise<CommentView[]> {
  const col = await comments();
  const docs = await col.find({ issueId }).sort({ createdAt: -1 }).toArray();
  return docs.map((d) => ({
    id: d._id.toHexString(),
    authorId: d.authorId,
    authorName: d.authorName,
    authorRole: d.authorRole,
    body: d.body,
    createdAt: d.createdAt,
    likes: d.likes ?? [],
    replies: (d.replies ?? []).map((r) => ({
      id: r._id.toHexString(),
      authorId: r.authorId,
      authorName: r.authorName,
      authorRole: r.authorRole,
      body: r.body,
      createdAt: r.createdAt,
    })),
  }));
}

export interface SearchHit {
  issueId: number;
  commentId: string;
  authorName: string;
  body: string;
  createdAt: Date;
  score: number;
}

/** Full-text search across comment and reply text (uses the `comment_text` text index). */
export async function searchComments(text: string, limit = 10): Promise<SearchHit[]> {
  if (!text.trim()) return [];
  const col = await comments();
  const docs = await col
    .find({ $text: { $search: text } }, { projection: { score: { $meta: 'textScore' } } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit)
    .toArray();
  return docs.map((d) => ({
    issueId: d.issueId,
    commentId: d._id.toHexString(),
    authorName: d.authorName,
    body: d.body,
    createdAt: d.createdAt,
    score: (d as unknown as { score: number }).score,
  }));
}

export function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) && id.length === 24 ? new ObjectId(id) : null;
}

// ------------------------------------------------------------------ housekeeping (best effort)
/** Remove the threads of deleted issues. */
export async function deleteThreads(issueIds: number[]): Promise<void> {
  if (issueIds.length === 0) return;
  try {
    await (await comments()).deleteMany({ issueId: { $in: issueIds } });
  } catch (e) {
    console.error('[discussion] could not delete threads', (e as Error).message);
  }
}

/** When an account is deleted keep the conversation readable but anonymise the author. */
export async function anonymiseAuthor(userId: number): Promise<void> {
  try {
    const col = await comments();
    await col.updateMany({ authorId: userId }, { $set: { authorName: '[deleted user]' }, $pull: { likes: userId } });
    // reply authors live in an embedded array -> arrayFilters picks only their replies
    await col.updateMany(
      { 'replies.authorId': userId },
      { $set: { 'replies.$[r].authorName': '[deleted user]' } },
      { arrayFilters: [{ 'r.authorId': userId }] },
    );
    await col.updateMany({ likes: userId }, { $pull: { likes: userId } });
  } catch (e) {
    console.error('[discussion] could not anonymise author', (e as Error).message);
  }
}
