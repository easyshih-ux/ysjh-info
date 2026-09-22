import { DEPARTMENTS, MAX_CUSTOM_DEPARTMENT_LENGTH, OTHER_DEPARTMENT_OPTION, isFixedDepartment, normalizeCustomDepartment, type FixedDepartment } from "./departments.ts";

export interface AnnouncementContact {
  department: string;
  extension: string;
}

export const MAX_CONTACT_EXTENSION_LENGTH = 6;
export const DEPARTMENT_EXTENSIONS: Record<FixedDepartment, string> = {
  校長: "600",
  教務處: "100",
  教學組: "101",
  註冊組: "102",
  資訊組: "103",
  設備組: "104",
  學務處: "200",
  生教組: "201",
  訓育組: "202",
  衛生組: "204",
  體育組: "290",
  健康中心: "208",
  總務處: "300",
  事務組: "301",
  文書組: "302",
  出納組: "303",
  輔導處: "500",
  輔導組: "501",
  特教組: "512",
  生涯組: "503",
  人事室: "611",
  會計室: "615",
};

export const CONTACT_DEPARTMENTS = DEPARTMENTS;

export function getFixedDepartmentExtension(department: string) {
  return isFixedDepartment(department) ? DEPARTMENT_EXTENSIONS[department] : undefined;
}

export function defaultContactForDepartment(department: string): AnnouncementContact {
  const fixedExtension = getFixedDepartmentExtension(department);
  return fixedExtension
    ? { department, extension: fixedExtension }
    : { department: normalizeCustomDepartment(department) ?? "", extension: "" };
}

export function selectContactDepartment(current: AnnouncementContact, selection: string): AnnouncementContact {
  const fixedExtension = getFixedDepartmentExtension(selection);
  if (fixedExtension) return { department: selection, extension: fixedExtension };
  if (selection === OTHER_DEPARTMENT_OPTION) {
    return isFixedDepartment(current.department) ? { department: "", extension: "" } : current;
  }
  return current;
}

export function isValidContactExtension(value: string) {
  return new RegExp(`^\\d{2,${MAX_CONTACT_EXTENSION_LENGTH}}$`).test(value.trim());
}

export function normalizeAnnouncementContact(contact: AnnouncementContact | undefined) {
  if (!contact) return undefined;
  const fixedExtension = getFixedDepartmentExtension(contact.department);
  if (fixedExtension) return { department: contact.department, extension: fixedExtension };
  const department = normalizeCustomDepartment(contact.department);
  const extension = contact.extension.trim();
  return department && isValidContactExtension(extension) ? { department, extension } : undefined;
}

export function validateAnnouncementContact(contact: AnnouncementContact | undefined) {
  if (!contact) return undefined;
  const fixedExtension = getFixedDepartmentExtension(contact.department);
  if (fixedExtension) return contact.extension === fixedExtension ? undefined : "固定聯絡單位的分機必須使用系統設定";
  const department = contact.department.trim();
  if (!department) return "請輸入實際聯絡單位名稱";
  if (department === OTHER_DEPARTMENT_OPTION) return "實際聯絡單位名稱不可使用「其他」";
  if (department.length > MAX_CUSTOM_DEPARTMENT_LENGTH) return `實際聯絡單位名稱不可超過 ${MAX_CUSTOM_DEPARTMENT_LENGTH} 個字`;
  if (!contact.extension.trim()) return "請輸入校內分機";
  if (!isValidContactExtension(contact.extension)) return `校內分機須為 2 至 ${MAX_CONTACT_EXTENSION_LENGTH} 位數字`;
  return undefined;
}

export function formatContactCompact(contact: AnnouncementContact) {
  return `☎ 業務聯絡｜${contact.department}｜分機 ${contact.extension}`;
}

export function formatContactSentence(contact: AnnouncementContact) {
  return `☎ 如有任何疑問，請洽${contact.department}，分機 ${contact.extension}。`;
}
