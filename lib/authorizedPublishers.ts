import { isDepartment, type Department } from "./departments.ts";

export interface AuthorizedPublisher {
  email: string;
  defaultDepartment: string;
  enabled: boolean;
}

export interface ValidAuthorizedPublisher extends AuthorizedPublisher {
  defaultDepartment: Department;
}

// Prototype source of truth. Replace this placeholder with a real publisher email
// only after that person has been explicitly approved.
export const authorizedPublishers: readonly AuthorizedPublisher[] = [
  {
    email: "easyshih@ysjh.ntpc.edu.tw",
    defaultDepartment: "設備組",
    enabled: true,
  },
];

export function normalizePublisherEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? "";
}

export function getAuthorizedPublisher(
  email: string | null | undefined,
  publishers: readonly AuthorizedPublisher[] = authorizedPublishers,
): ValidAuthorizedPublisher | null {
  const normalizedEmail = normalizePublisherEmail(email);
  if (!normalizedEmail) return null;

  const publisher = publishers.find(
    candidate => normalizePublisherEmail(candidate.email) === normalizedEmail,
  );

  if (!publisher?.enabled || !isDepartment(publisher.defaultDepartment)) return null;

  return {
    ...publisher,
    email: normalizePublisherEmail(publisher.email),
    defaultDepartment: publisher.defaultDepartment,
  };
}
