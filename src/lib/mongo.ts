/**
 * MongoDB access layer (NoSQL).
 *
 * Two collections live here because they are document-shaped, schema-flexible and write-heavy:
 *
 *   comments      one document per top-level comment on an issue, with its replies EMBEDDED
 *                 as an array (no joins needed to render a thread) and likes as a set of user ids.
 *   activity_log  an append-only event stream; every event type carries a different `meta` payload,
 *                 and old events expire automatically through a TTL index.
 *
 * Relational facts (users, issues, applications) stay in PostgreSQL; Mongo documents reference them
 * by numeric id (polyglot persistence).
 */
import { MongoClient, ObjectId, type Collection, type Db } from 'mongodb';

export interface ReplyDoc {
  _id: ObjectId;
  authorId: number;
  authorName: string;
  authorRole: 'contributor' | 'maintainer';
  body: string;
  createdAt: Date;
}

export interface CommentDoc {
  _id: ObjectId;
  issueId: number;
  authorId: number;
  authorName: string;
  authorRole: 'contributor' | 'maintainer';
  body: string;
  createdAt: Date;
  likes: number[];
  replies: ReplyDoc[];
}

export interface ActivityDoc {
  _id?: ObjectId;
  ts: Date;
  type: string;
  actorId: number;
  actorName: string;
  actorRole: string;
  issueId?: number;
  projectId?: number;
  meta?: Record<string, unknown>;
}

export const ACTIVITY_TTL_SECONDS = 60 * 60 * 24 * 90; // events are kept for 90 days

declare global {
  // eslint-disable-next-line no-var
  var __mongoClient: Promise<MongoClient> | undefined;
  // eslint-disable-next-line no-var
  var __mongoReady: Promise<void> | undefined;
}

const uri = () => process.env.MONGODB_URI ?? 'mongodb://localhost:27017';
export const dbName = () => process.env.MONGODB_DB ?? 'devmatch';

function client(): Promise<MongoClient> {
  if (!globalThis.__mongoClient) {
    globalThis.__mongoClient = new MongoClient(uri(), { serverSelectionTimeoutMS: 4000 }).connect();
  }
  return globalThis.__mongoClient;
}

export async function getDb(): Promise<Db> {
  let c: MongoClient;
  try {
    c = await client();
  } catch (e) {
    globalThis.__mongoClient = undefined; // allow a retry on the next request
    throw e;
  }
  const db = c.db(dbName());
  if (!globalThis.__mongoReady) {
    globalThis.__mongoReady = setupMongo(db).catch((e) => {
      globalThis.__mongoReady = undefined;
      throw e;
    });
  }
  await globalThis.__mongoReady;
  return db;
}

export async function comments(): Promise<Collection<CommentDoc>> {
  return (await getDb()).collection<CommentDoc>('comments');
}

export async function activityLog(): Promise<Collection<ActivityDoc>> {
  return (await getDb()).collection<ActivityDoc>('activity_log');
}

export async function closeMongo(): Promise<void> {
  if (globalThis.__mongoClient) {
    const c = await globalThis.__mongoClient.catch(() => null);
    await c?.close();
  }
  globalThis.__mongoClient = undefined;
  globalThis.__mongoReady = undefined;
}

// ---------------------------------------------------------------------------------------------
// Collections, JSON-Schema validators and indexes.  Idempotent — safe to call on every start.
// (db/mongo-init.js does the same thing from mongosh.)
// ---------------------------------------------------------------------------------------------
const commentValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['issueId', 'authorId', 'authorName', 'authorRole', 'body', 'createdAt', 'likes', 'replies'],
    properties: {
      issueId: { bsonType: ['int', 'long', 'double'], minimum: 1 },
      authorId: { bsonType: ['int', 'long', 'double'], minimum: 1 },
      authorName: { bsonType: 'string' },
      authorRole: { enum: ['contributor', 'maintainer'] },
      body: { bsonType: 'string', minLength: 1, maxLength: 2000 },
      createdAt: { bsonType: 'date' },
      likes: { bsonType: 'array', items: { bsonType: ['int', 'long', 'double'] } },
      replies: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['_id', 'authorId', 'authorName', 'body', 'createdAt'],
          properties: {
            body: { bsonType: 'string', minLength: 1, maxLength: 2000 },
            createdAt: { bsonType: 'date' },
          },
        },
      },
    },
  },
};

const activityValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['ts', 'type', 'actorId', 'actorName'],
    properties: {
      ts: { bsonType: 'date' },
      type: { bsonType: 'string' },
      actorId: { bsonType: ['int', 'long', 'double'] },
      actorName: { bsonType: 'string' },
      meta: { bsonType: 'object' },
    },
  },
};

async function ensureCollection(db: Db, name: string, validator: object) {
  const exists = (await db.listCollections({ name }).toArray()).length > 0;
  if (!exists) {
    await db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' });
  } else {
    await db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
  }
}

export async function setupMongo(db?: Db): Promise<void> {
  const d = db ?? (await client()).db(dbName());

  await ensureCollection(d, 'comments', commentValidator);
  await ensureCollection(d, 'activity_log', activityValidator);

  const c = d.collection('comments');
  await c.createIndex({ issueId: 1, createdAt: -1 }, { name: 'issue_thread' });
  await c.createIndex({ authorId: 1 }, { name: 'by_author' });
  await c.createIndex({ 'replies.authorId': 1 }, { name: 'by_reply_author' }); // multikey index on an embedded array
  await c.createIndex({ body: 'text', 'replies.body': 'text' }, { name: 'comment_text' }); // full-text search

  const a = d.collection('activity_log');
  await a.createIndex({ ts: -1 }, { name: 'recent_first' });
  await a.createIndex({ type: 1, ts: -1 }, { name: 'by_type' });
  await a.createIndex({ actorId: 1, ts: -1 }, { name: 'by_actor' });
  await a.createIndex({ ts: 1 }, { name: 'ttl_90_days', expireAfterSeconds: ACTIVITY_TTL_SECONDS }); // auto-expire
}

export { ObjectId };
