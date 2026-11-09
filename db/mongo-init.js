// =====================================================================
//  DevMatch — MongoDB setup (mongosh). Same effect as setupMongo() in src/lib/mongo.ts.
//
//    mongosh "mongodb://localhost:27017/devmatch" --file db/mongo-init.js
//
//  Idempotent: safe to run more than once.
//
//  Collections
//    comments      discussion threads on issues; replies are EMBEDDED in each comment document
//    activity_log  append-only event stream; `meta` differs per event type; TTL index expires old events
// =====================================================================

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

function ensureCollection(name, validator) {
  const exists = db.getCollectionInfos({ name }).length > 0;
  if (!exists) {
    db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' });
    print(`created collection ${name}`);
  } else {
    db.runCommand({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
    print(`updated validator of ${name}`);
  }
}

ensureCollection('comments', commentValidator);
ensureCollection('activity_log', activityValidator);

// --- comments: thread lookup, author lookup, multikey index on the embedded array, full-text search
db.comments.createIndex({ issueId: 1, createdAt: -1 }, { name: 'issue_thread' });
db.comments.createIndex({ authorId: 1 }, { name: 'by_author' });
db.comments.createIndex({ 'replies.authorId': 1 }, { name: 'by_reply_author' });
db.comments.createIndex({ body: 'text', 'replies.body': 'text' }, { name: 'comment_text' });

// --- activity_log: newest first, by type, by actor, and a TTL index (events vanish after 90 days)
db.activity_log.createIndex({ ts: -1 }, { name: 'recent_first' });
db.activity_log.createIndex({ type: 1, ts: -1 }, { name: 'by_type' });
db.activity_log.createIndex({ actorId: 1, ts: -1 }, { name: 'by_actor' });
db.activity_log.createIndex({ ts: 1 }, { name: 'ttl_90_days', expireAfterSeconds: 60 * 60 * 24 * 90 });

print('\nIndexes on comments:      ' + db.comments.getIndexes().map((i) => i.name).join(', '));
print('Indexes on activity_log:  ' + db.activity_log.getIndexes().map((i) => i.name).join(', '));
