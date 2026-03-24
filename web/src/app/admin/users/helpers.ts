import { ROLE_ADMIN, ROLE_MODERATOR } from "../../../lib/api";
import type { AdminUserEntry } from "../../../lib/api";

export function getLocalizedAdminRoleLabel(
  role: string,
  labels: {
    admin: string;
    moderator: string;
    standardUser: string;
  }
): string {
  if (role === ROLE_ADMIN) {
    return labels.admin;
  }

  if (role === ROLE_MODERATOR) {
    return labels.moderator;
  }

  return labels.standardUser;
}

export function filterAdminUserEntries(
  entries: AdminUserEntry[],
  searchQuery: string
): AdminUserEntry[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return entries;
  }

  return entries.filter((entry) =>
    [entry.username, entry.role, entry.isBanned ? "banned" : "active"]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery)
  );
}
