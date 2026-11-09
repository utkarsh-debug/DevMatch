// =====================================================================
//  DevMatch — MongoDB command reference (mongosh)
//
//    mongosh "mongodb://localhost:27017/devmatch" --file db/mongo-commands.js
//
//  Runs against the seeded database. Documents it creates use issueId 999999 and are deleted at the end.
// =====================================================================
const show = (title, value) => {
  print('\n== ' + title + ' ==');
  printjson(value);
};

// ---------------------------------------------------------------- 0. inspect
show('0. collections and sizes', {
  database: db.getName(),
  collections: db.getCollectionNames(),
  comments: db.comments.countDocuments(),
  activity_log: db.activity_log.countDocuments(),
});
show('0. one comment document (replies are embedded)', db.comments.findOne({}, { body: 1, authorName: 1, likes: 1, replies: 1 }));

// ---------------------------------------------------------------- 1. CREATE
const t0 = new Date();
const r1 = db.comments.insertOne({
  issueId: 999999, authorId: 1, authorName: 'Demo Author', authorRole: 'contributor',
  body: 'Is a cursor-based approach acceptable for the first version?', createdAt: t0, likes: [], replies: [],
});
const r2 = db.comments.insertMany([
  { issueId: 999999, authorId: 2, authorName: 'Demo Maintainer', authorRole: 'maintainer',
    body: 'Please add a benchmark with the trigram index', createdAt: new Date(t0.getTime() + 1000), likes: [1, 3], replies: [] },
  { issueId: 999999, authorId: 3, authorName: 'Demo Reviewer', authorRole: 'contributor',
    body: 'I can pick this up next week', createdAt: new Date(t0.getTime() + 2000), likes: [], replies: [] },
]);
show('1. insertOne / insertMany', { insertedOne: r1.acknowledged, insertedMany: Object.keys(r2.insertedIds).length });

db.activity_log.insertOne({ ts: new Date(), type: 'demo_event', actorId: 1, actorName: 'Demo Author', actorRole: 'contributor',
  issueId: 999999, meta: { note: 'meta can hold any shape', tags: ['a', 'b'], nested: { ok: true } } });

// ---------------------------------------------------------------- 2. READ
show('2a. find + filter + projection + sort + limit',
  db.comments.find({ issueId: 999999 }, { _id: 0, authorName: 1, body: 1 }).sort({ createdAt: -1 }).limit(2).toArray());
show('2b. comparison and logical operators ($gte, $and, $or)',
  db.comments.find({ $and: [{ issueId: { $gte: 1 } }, { $or: [{ authorRole: 'maintainer' }, { likes: { $size: 2 } }] }] },
    { _id: 0, issueId: 1, authorName: 1, authorRole: 1 }).limit(4).toArray());
show('2c. array operators: likes contains 1, $size, $elemMatch on embedded replies',
  {
    likedByUser1: db.comments.countDocuments({ issueId: 999999, likes: 1 }),
    withTwoLikes: db.comments.countDocuments({ issueId: 999999, likes: { $size: 2 } }),
    withMaintainerReply: db.comments.countDocuments({ replies: { $elemMatch: { authorRole: 'maintainer' } } }),
  });
show('2d. regular expression + dot notation into an embedded document',
  db.comments.find({ body: /index/i }, { _id: 0, authorName: 1, body: 1 }).limit(3).toArray());
show('2e. distinct and count', {
  eventTypes: db.activity_log.distinct('type'),
  issuesWithThreads: db.comments.distinct('issueId').length,
});

// ---------------------------------------------------------------- 3. UPDATE
const first = db.comments.findOne({ issueId: 999999, authorId: 1 });
db.comments.updateOne({ _id: first._id }, { $set: { body: first.body + ' (edited)' } });
db.comments.updateOne({ _id: first._id }, {
  $push: { replies: { _id: new ObjectId(), authorId: 2, authorName: 'Demo Maintainer', authorRole: 'maintainer', body: 'Yes, cursor-based please', createdAt: new Date() } },
});
db.comments.updateOne({ _id: first._id }, { $addToSet: { likes: 2 } });
db.comments.updateOne({ _id: first._id }, { $addToSet: { likes: 2 } }); // duplicate -> ignored: likes behaves as a set
show('3a. $set, $push (embedded reply) and $addToSet', db.comments.findOne({ _id: first._id }, { _id: 0, body: 1, likes: 1, 'replies.body': 1 }));

db.comments.updateOne({ _id: first._id }, { $pull: { likes: 2 } });
db.comments.updateOne({ _id: first._id, 'replies.authorId': 2 }, { $set: { 'replies.$.body': 'Yes, cursor-based please (edited)' } }); // positional operator
show('3b. $pull and the positional $ operator', db.comments.findOne({ _id: first._id }, { _id: 0, likes: 1, 'replies.body': 1 }));

db.comments.updateMany({ issueId: 999999, authorId: 1 }, { $set: { authorName: '[deleted user]' } });
db.comments.updateMany({ issueId: 999999 }, { $set: { 'replies.$[r].authorName': '[deleted user]' } }, { arrayFilters: [{ 'r.authorId': 2 }] });
show('3c. updateMany + arrayFilters (anonymise an author everywhere)',
  db.comments.find({ issueId: 999999 }, { _id: 0, authorName: 1, 'replies.authorName': 1 }).sort({ createdAt: 1 }).toArray());

const up = db.activity_log.updateOne({ type: 'demo_upsert' }, { $setOnInsert: { ts: new Date(), actorId: 1, actorName: 'Demo' }, $inc: { 'meta.count': 1 } }, { upsert: true });
db.activity_log.updateOne({ type: 'demo_upsert' }, { $inc: { 'meta.count': 1 } });
show('3d. upsert + $inc', { upsertedCount: up.upsertedCount, counter: db.activity_log.findOne({ type: 'demo_upsert' }).meta.count });

// ---------------------------------------------------------------- 4. AGGREGATION
show('4a. events by type  ($group, $sort)', db.activity_log.aggregate([
  { $group: { _id: '$type', events: { $sum: 1 } } },
  { $sort: { events: -1, _id: 1 } },
  { $limit: 6 },
]).toArray());

show('4b. events per day  ($match, $dateToString)', db.activity_log.aggregate([
  { $match: { ts: { $gte: new Date(Date.now() - 14 * 86400000) } } },
  { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } }, events: { $sum: 1 } } },
  { $sort: { _id: 1 } },
]).toArray().slice(-5));

show('4c. most active users  ($group + $addToSet + $project + $size)', db.activity_log.aggregate([
  { $group: { _id: { actor: '$actorName', role: '$actorRole' }, events: { $sum: 1 }, kinds: { $addToSet: '$type' }, lastSeen: { $max: '$ts' } } },
  { $project: { _id: 0, actor: '$_id.actor', role: '$_id.role', events: 1, distinctKinds: { $size: '$kinds' } } },
  { $sort: { events: -1, actor: 1 } },
  { $limit: 3 },
]).toArray());

show('4d. most discussed issues  ($project with $size, $group, $addFields)', db.comments.aggregate([
  { $match: { issueId: { $lt: 999999 } } },
  { $project: { issueId: 1, replyCount: { $size: '$replies' }, likeCount: { $size: '$likes' } } },
  { $group: { _id: '$issueId', comments: { $sum: 1 }, replies: { $sum: '$replyCount' }, likes: { $sum: '$likeCount' } } },
  { $addFields: { messages: { $add: ['$comments', '$replies'] } } },
  { $sort: { messages: -1, _id: 1 } },
  { $limit: 3 },
]).toArray());

show('4e. who replies most  ($unwind on an embedded array)', db.comments.aggregate([
  { $match: { issueId: { $lt: 999999 } } },
  { $unwind: '$replies' },
  { $group: { _id: '$replies.authorName', replies: { $sum: 1 } } },
  { $sort: { replies: -1, _id: 1 } },
  { $limit: 3 },
]).toArray());

show('4f. collection-to-collection join  ($lookup)', db.comments.aggregate([
  { $match: { issueId: { $lt: 999999 } } },
  { $group: { _id: '$issueId', comments: { $sum: 1 } } },
  { $lookup: { from: 'activity_log', localField: '_id', foreignField: 'issueId', as: 'events' } },
  { $project: { _id: 1, comments: 1, relatedEvents: { $size: '$events' } } },
  { $sort: { _id: 1 } },
  { $limit: 3 },
]).toArray());

// ---------------------------------------------------------------- 5. TEXT SEARCH
show('5. full-text search with relevance score ($text, $meta: textScore)', db.comments.find(
  { $text: { $search: 'trigram index benchmark' } }, { _id: 0, authorName: 1, body: 1, score: { $meta: 'textScore' } },
).sort({ score: { $meta: 'textScore' } }).limit(3).toArray());

// ---------------------------------------------------------------- 6. INDEXES AND PLANS
const plan = db.comments.find({ issueId: 999999 }).sort({ createdAt: -1 }).explain('executionStats');
const winning = plan.queryPlanner.winningPlan.queryPlan ?? plan.queryPlanner.winningPlan;
const chain = (p) => [p.stage].concat(p.inputStage ? chain(p.inputStage) : []);
show('6a. explain(): the thread query uses the issue_thread index', {
  stages: chain(winning),
  index: JSON.stringify(plan.queryPlanner.winningPlan).match(/"indexName":"([^"]+)"/)?.[1],
  docsExamined: plan.executionStats.totalDocsExamined,
  returned: plan.executionStats.nReturned,
});
show('6b. all indexes', {
  comments: db.comments.getIndexes().map((i) => i.name),
  activity_log: db.activity_log.getIndexes().map((i) => ({ name: i.name, ttlSeconds: i.expireAfterSeconds })),
});

// ---------------------------------------------------------------- 7. SCHEMA VALIDATION
const attempts = {};
for (const [label, doc] of [
  ['missing required fields', { issueId: 1 }],
  ['empty body', { issueId: 1, authorId: 1, authorName: 'x', authorRole: 'contributor', body: '', createdAt: new Date(), likes: [], replies: [] }],
  ['invalid role', { issueId: 1, authorId: 1, authorName: 'x', authorRole: 'admin', body: 'hi', createdAt: new Date(), likes: [], replies: [] }],
]) {
  try { db.comments.insertOne(doc); attempts[label] = 'ACCEPTED (unexpected)'; } catch (e) { attempts[label] = 'rejected, code ' + e.code; }
}
show('7. $jsonSchema validator rejects bad documents', attempts);

// ---------------------------------------------------------------- 8. DELETE (cleanup)
const d1 = db.comments.deleteOne({ issueId: 999999, authorId: 3 });
const d2 = db.comments.deleteMany({ issueId: 999999 });
const d3 = db.activity_log.deleteMany({ type: { $in: ['demo_event', 'demo_upsert'] } });
show('8. deleteOne / deleteMany', { deleteOne: d1.deletedCount, deleteMany: d2.deletedCount, activityCleaned: d3.deletedCount });
