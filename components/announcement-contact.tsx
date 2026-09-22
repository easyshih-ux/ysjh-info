import type { AnnouncementContact } from "@/lib/departmentContacts";
import { formatContactCompact } from "@/lib/departmentContacts";

export function AnnouncementContactLine({ contact, className }: { contact?: AnnouncementContact; className?: string }) {
  return contact ? <p className={className}>{formatContactCompact(contact)}</p> : null;
}
