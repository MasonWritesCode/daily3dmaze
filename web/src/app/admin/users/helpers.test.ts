import { describe, expect, it } from "vitest";

import type { AdminUserEntry } from "../../../lib/api";
import {
  filterAdminUserEntries,
  getLocalizedAdminRoleLabel
} from "./helpers";

function makeEntry(overrides: Partial<AdminUserEntry> = {}): AdminUserEntry {
  return {
    username: "mason",
    role: "user",
    isBanned: false,
    bannedAt: null,
    createdAt: "2026-03-23T10:00:00Z",
    ...overrides
  };
}

describe("admin users helpers", () => {
  it("localizes admin page role labels", () => {
    const labels = {
      admin: "Admin",
      moderator: "Moderator",
      standardUser: "User"
    };

    expect(getLocalizedAdminRoleLabel("admin", labels)).toBe("Admin");
    expect(getLocalizedAdminRoleLabel("moderator", labels)).toBe("Moderator");
    expect(getLocalizedAdminRoleLabel("user", labels)).toBe("User");
  });

  it("filters users by username, role, and ban state", () => {
    const entries = [
      makeEntry({ username: "mason", role: "admin" }),
      makeEntry({ username: "dani", role: "moderator" }),
      makeEntry({ username: "anon", role: "user", isBanned: true })
    ];

    expect(filterAdminUserEntries(entries, "mod").map((entry) => entry.username)).toEqual([
      "dani"
    ]);

    expect(filterAdminUserEntries(entries, "banned").map((entry) => entry.username)).toEqual([
      "anon"
    ]);

    expect(filterAdminUserEntries(entries, "mason").map((entry) => entry.username)).toEqual([
      "mason"
    ]);
  });
});
