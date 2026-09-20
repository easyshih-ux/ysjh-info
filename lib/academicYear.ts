import type { Announcement } from "./announcements.ts";

/** 每年只需修改這一處。 */
export const CURRENT_ACADEMIC_YEAR = 115;
export const NEXT_ACADEMIC_YEAR = CURRENT_ACADEMIC_YEAR + 1;
export const FRONTEND_ACADEMIC_YEARS = [CURRENT_ACADEMIC_YEAR, NEXT_ACADEMIC_YEAR] as const;

export function announcementsForAcademicYear(announcements: Announcement[], academicYear: number) {
  return announcements.filter(item => item.academicYear === academicYear);
}

export function isFrontendAcademicYear(value: number) {
  return FRONTEND_ACADEMIC_YEARS.includes(value as (typeof FRONTEND_ACADEMIC_YEARS)[number]);
}
