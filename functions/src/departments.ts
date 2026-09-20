// Keep this backend authorization allowlist synchronized with lib/departments.ts.
export const DEPARTMENTS = [
  "教務處",
  "教學組",
  "註冊組",
  "資訊組",
  "設備組",
  "學務處",
  "生教組",
  "訓育組",
  "衛生組",
  "體育組",
  "健康中心",
  "總務處",
  "文書組",
  "出納組",
  "事務組",
  "輔導處",
  "特教組",
  "輔導組",
  "生涯組",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

export function isDepartment(value: unknown): value is Department {
  return typeof value === "string" && DEPARTMENTS.includes(value as Department);
}
