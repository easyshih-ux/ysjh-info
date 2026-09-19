export const SCHOOL_EMAIL_DOMAINS = ["apps.ntpc.edu.tw", "ysjh.ntpc.edu.tw"] as const;

export function getEmailDomain(email: string | null | undefined) {
  if (!email) return "";
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase() : "";
}

export function isExpectedSchoolEmail(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase() ?? "";
  return SCHOOL_EMAIL_DOMAINS.some(domain => normalized.endsWith(`@${domain}`));
}
