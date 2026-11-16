export type Role = 'owner' | 'editor' | 'viewer';
export interface User {
  id: string;
  username: string;
  name: string;
}
export interface DocumentInfo {
  id: string;
  title: string;
  owner: string;
  role: Role;
  updatedAt: number;
  createdAt: number;
  revision: number;
}
export interface Activity {
  id: number;
  actor: string;
  kind: string;
  bytes: number;
  at: number;
}
export interface Presence {
  client: number;
  name: string;
  color: string;
  cursor?: unknown;
}
export type ClientFrame =
  | { type: 'hello'; vector: string }
  | { type: 'update'; id: string; data: string }
  | { type: 'presence'; data: string }
  | { type: 'ping' };
export type ServerFrame =
  | { type: 'welcome'; user: User; role: Role; vector: string; state: string; revision: number }
  | { type: 'update'; data: string; revision: number }
  | { type: 'ack'; id: string; revision: number }
  | { type: 'presence'; data: string }
  | { type: 'error'; message: string }
  | { type: 'pong' };
export const MAX_TEXT = 200_000;
export const MAX_UPDATE = 512 * 1024;
