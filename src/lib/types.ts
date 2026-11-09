export type Role = 'contributor' | 'maintainer';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type IssueStatus = 'open' | 'in_progress' | 'closed';
export type AppStatus = 'pending' | 'accepted' | 'rejected';
export type Level = 'beginner' | 'intermediate' | 'advanced';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
export const STATUSES: IssueStatus[] = ['open', 'in_progress', 'closed'];
export const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  bio: string | null;
  account_status: string;
}

export type SkillRow = { name: string; level: Level };

export type FormState =
  | {
      error?: string;
      values?: Record<string, unknown>;
    }
  | undefined;
