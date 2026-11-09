/**
 * MongoDB aggregation pipelines over the activity log and discussion threads.
 * Each function returns the pipeline it ran (so the UI and the report can show it) plus the rows.
 */
import type { Document } from 'mongodb';
import { activityLog, comments, type ActivityDoc } from '@/lib/mongo';

export interface PipelineResult {
  title: string;
  collection: string;
  pipeline: Document[];
  rows: Document[];
}

/** JSON in mongosh style: dates become ISODate("...") */
export function shellJson(value: unknown): string {
  const json = JSON.stringify(
    value,
    function (this: any, key: string, v: unknown) {
      const raw = this[key];
      return raw instanceof Date ? `__ISO__${raw.toISOString()}` : v;
    },
    2,
  );
  return json.replace(/"__ISO__([^"]+)"/g, 'ISODate("$1")');
}

export async function recentActivity(limit = 40, type?: string): Promise<ActivityDoc[]> {
  const col = await activityLog();
  return col
    .find(type ? { type } : {})
    .sort({ ts: -1 })
    .limit(limit)
    .toArray();
}

export async function activityTypes(): Promise<string[]> {
  const col = await activityLog();
  return (await col.distinct('type')).sort();
}

export async function eventsByType(): Promise<PipelineResult> {
  const pipeline: Document[] = [{ $group: { _id: '$type', events: { $sum: 1 } } }, { $sort: { events: -1, _id: 1 } }];
  const rows = await (await activityLog()).aggregate(pipeline).toArray();
  return { title: 'Events by type', collection: 'activity_log', pipeline, rows };
}

export async function eventsPerDay(days = 14): Promise<PipelineResult> {
  const since = new Date(Date.now() - days * 86_400_000);
  const pipeline: Document[] = [
    { $match: { ts: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } }, events: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ];
  const rows = await (await activityLog()).aggregate(pipeline).toArray();
  return { title: `Events per day (last ${days} days)`, collection: 'activity_log', pipeline, rows };
}

export async function mostActiveUsers(limit = 5): Promise<PipelineResult> {
  const pipeline: Document[] = [
    {
      $group: {
        _id: { actor: '$actorName', role: '$actorRole' },
        events: { $sum: 1 },
        distinctTypes: { $addToSet: '$type' },
        lastSeen: { $max: '$ts' },
      },
    },
    { $project: { _id: 0, actor: '$_id.actor', role: '$_id.role', events: 1, kinds: { $size: '$distinctTypes' }, lastSeen: 1 } },
    { $sort: { events: -1, actor: 1 } },
    { $limit: limit },
  ];
  const rows = await (await activityLog()).aggregate(pipeline).toArray();
  return { title: 'Most active users ($group + $addToSet + $size)', collection: 'activity_log', pipeline, rows };
}

export async function mostDiscussedIssues(limit = 5): Promise<PipelineResult> {
  const pipeline: Document[] = [
    { $project: { issueId: 1, replyCount: { $size: '$replies' }, likeCount: { $size: '$likes' } } },
    {
      $group: {
        _id: '$issueId',
        comments: { $sum: 1 },
        replies: { $sum: '$replyCount' },
        likes: { $sum: '$likeCount' },
      },
    },
    { $addFields: { messages: { $add: ['$comments', '$replies'] } } },
    { $sort: { messages: -1, _id: 1 } },
    { $limit: limit },
  ];
  const rows = await (await comments()).aggregate(pipeline).toArray();
  return { title: 'Most discussed issues ($size on embedded arrays)', collection: 'comments', pipeline, rows };
}
