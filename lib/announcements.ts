export const AUDIENCES = ["七年級導師", "八年級導師", "九年級導師", "專任教師", "行政", "全校教師"] as const;
export { DEPARTMENTS } from "./departments.ts";
export type { Department } from "./departments.ts";

export type Audience = (typeof AUDIENCES)[number];
import type { Department } from "./departments.ts";
export const USER_IDENTITIES = ["七年級導師", "八年級導師", "九年級導師", "專任教師", "行政"] as const;
export type UserIdentity = (typeof USER_IDENTITIES)[number];

export interface ImportantEvent { date: string; time?: string; title: string }
export interface Deadline { date: string; time?: string; label: string }
export interface Attachment { id: string; type: "image"; url: string; name: string; caption?: string }
export interface FollowUp { createdAt: string; type: "supplement" | "reminder"; message: string }
export interface AnnouncementLink { id: string; label: string; url: string; type: "website"; isPrimary: boolean }
export interface Announcement {
  id: string;
  updatedAt?: string;
  academicYear: number;
  publishedAt: string;
  department: Department;
  title: string;
  audiences: Audience[];
  content: string;
  importantEvents: ImportantEvent[];
  deadlines: Deadline[];
  attachments: Attachment[];
  followUps: FollowUp[];
  links: AnnouncementLink[];
}
