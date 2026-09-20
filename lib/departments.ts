export const departmentGroups = [
  { office: "教務處", departments: ["教務處", "教學組", "註冊組", "資訊組", "設備組"] },
  { office: "學務處", departments: ["學務處", "生教組", "訓育組", "衛生組", "體育組", "健康中心"] },
  { office: "總務處", departments: ["總務處", "出納組", "文書組", "事務組"] },
  { office: "輔導處", departments: ["輔導處", "輔導組", "特教組", "生涯組"] },
] as const;

export const standaloneDepartments = ["校長", "人事室", "會計室"] as const;
export const DEPARTMENTS = [
  ...standaloneDepartments,
  ...departmentGroups.flatMap(group => group.departments),
] as const;
export const OTHER_DEPARTMENT_OPTION = "其他" as const;
export const MAX_CUSTOM_DEPARTMENT_LENGTH = 30;
export const PUBLISHER_REQUEST_DEPARTMENT_OPTIONS = [...DEPARTMENTS, OTHER_DEPARTMENT_OPTION] as const;
export type FixedDepartment = (typeof DEPARTMENTS)[number];
export type Department = string;

export function isFixedDepartment(value: unknown): value is FixedDepartment {
  return typeof value === "string" && DEPARTMENTS.includes(value as FixedDepartment);
}

export function normalizeCustomDepartment(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized
    && normalized !== OTHER_DEPARTMENT_OPTION
    && normalized.length <= MAX_CUSTOM_DEPARTMENT_LENGTH
    ? normalized
    : null;
}

export function isDepartment(value: unknown): value is Department {
  return isFixedDepartment(value) || normalizeCustomDepartment(value) === value;
}

export function isPublisherRequestDepartment(value: unknown) {
  return isFixedDepartment(value) || value === OTHER_DEPARTMENT_OPTION;
}

export function resolveDepartmentSelection(selection: unknown, customName: unknown) {
  if (isFixedDepartment(selection)) return selection;
  return selection === OTHER_DEPARTMENT_OPTION ? normalizeCustomDepartment(customName) : null;
}
