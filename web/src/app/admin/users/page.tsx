"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  fetchAdminUsers,
  fetchCurrentUser,
  roleAllows,
  ROLE_ADMIN,
  ROLE_MODERATOR,
  ROLE_USER,
  updateAdminUserBan,
  updateAdminUserRole,
  type AdminUserEntry,
  type AuthUser
} from "../../../lib/api";

type PageStatus = "loading" | "ready" | "error";
type RowStatus = "idle" | "submitting" | "success" | "error";

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export default function AdminUsersPage() {
  const [status, setStatus] = useState<PageStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [entries, setEntries] = useState<AdminUserEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [roleValues, setRoleValues] = useState<Record<string, string>>({});
  const [rowStatuses, setRowStatuses] = useState<Record<string, RowStatus>>({});
  const [rowMessages, setRowMessages] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function loadPage() {
      setStatus("loading");
      setErrorMessage(null);

      try {
        const currentUser = await fetchCurrentUser();
        if (cancelled) {
          return;
        }

        setUser(currentUser);
        if (!currentUser || !roleAllows(currentUser.role, ROLE_ADMIN)) {
          setStatus("ready");
          return;
        }

        const payload = await fetchAdminUsers();
        if (cancelled) {
          return;
        }

        setEntries(payload.entries);
        setRoleValues(
          Object.fromEntries(payload.entries.map((entry) => [entry.username, entry.role]))
        );
        setStatus("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load admin users."
        );
      }
    }

    void loadPage();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredEntries = useMemo(() => {
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
  }, [entries, searchQuery]);

  function patchEntry(username: string, patch: Partial<AdminUserEntry>) {
    setEntries((currentEntries) =>
      currentEntries.map((entry) =>
        entry.username === username ? { ...entry, ...patch } : entry
      )
    );
  }

  async function handleRoleSave(entry: AdminUserEntry) {
    const nextRole = roleValues[entry.username] ?? entry.role;
    setRowStatuses((current) => ({ ...current, [entry.username]: "submitting" }));
    setRowMessages((current) => ({ ...current, [entry.username]: "" }));

    try {
      const result = await updateAdminUserRole(entry.username, nextRole);
      patchEntry(entry.username, { role: result.role });
      setRowStatuses((current) => ({ ...current, [entry.username]: "success" }));
      setRowMessages((current) => ({
        ...current,
        [entry.username]: `Role updated to ${result.role}.`
      }));
    } catch (error) {
      setRowStatuses((current) => ({ ...current, [entry.username]: "error" }));
      setRowMessages((current) => ({
        ...current,
        [entry.username]:
          error instanceof Error ? error.message : "Unable to update user role."
      }));
    }
  }

  async function handleBanToggle(entry: AdminUserEntry) {
    setRowStatuses((current) => ({ ...current, [entry.username]: "submitting" }));
    setRowMessages((current) => ({ ...current, [entry.username]: "" }));

    try {
      const result = await updateAdminUserBan(entry.username, !entry.isBanned);
      patchEntry(entry.username, {
        isBanned: result.isBanned,
        bannedAt: result.bannedAt
      });
      setRowStatuses((current) => ({ ...current, [entry.username]: "success" }));
      setRowMessages((current) => ({
        ...current,
        [entry.username]: result.isBanned
          ? "User banned and active sessions cleared."
          : "User unbanned."
      }));
    } catch (error) {
      setRowStatuses((current) => ({ ...current, [entry.username]: "error" }));
      setRowMessages((current) => ({
        ...current,
        [entry.username]:
          error instanceof Error ? error.message : "Unable to update ban state."
      }));
    }
  }

  return (
    <main className="page-shell">
      <div className="content-card content-card-wide">
        <p className="eyebrow">Internal tooling</p>
        <h1>User management</h1>
        <p className="body-copy">
          Admins can grant or revoke moderator access and ban or unban accounts.
        </p>
        <div className="actions">
          <Link href="/admin/reviews" className="primary-link">
            Back to reviews
          </Link>
          <Link href="/play" className="secondary-link">
            Back to play
          </Link>
        </div>

        {status === "loading" && (
          <p className="status-copy" aria-live="polite">
            Loading users...
          </p>
        )}

        {status === "error" && errorMessage && (
          <p className="status-copy error-copy" role="alert">
            {errorMessage}
          </p>
        )}

        {status === "ready" && !user && (
          <section className="maze-summary" aria-labelledby="users-auth-title">
            <h2 id="users-auth-title" className="section-title">
              Sign in required
            </h2>
            <p className="body-copy">Admin user management requires an authenticated session.</p>
          </section>
        )}

        {status === "ready" && user && !roleAllows(user.role, ROLE_ADMIN) && (
          <section className="maze-summary" aria-labelledby="users-forbidden-title">
            <h2 id="users-forbidden-title" className="section-title">
              Admin access required
            </h2>
            <p className="body-copy">
              Your current role is <code>{user.role}</code>. Only admins can manage
              user roles and bans.
            </p>
          </section>
        )}

        {status === "ready" && user && roleAllows(user.role, ROLE_ADMIN) && (
          <section className="maze-summary" aria-labelledby="user-list-title">
            <div className="review-header">
              <div>
                <h2 id="user-list-title" className="section-title">
                  Accounts
                </h2>
                <p className="assistive-copy">
                  Signed in as <strong>{user.username}</strong>.
                </p>
              </div>
            </div>

            <label className="auth-field" htmlFor="user-search">
              <span>Search users</span>
              <input
                id="user-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by username, role, or status"
              />
            </label>

            <div className="review-list" role="list" aria-label="Managed users">
              <div className="review-row review-row-header" role="listitem" aria-hidden="true">
                <span>User</span>
                <span>Role</span>
                <span>Status</span>
                <span>Created</span>
                <span>Actions</span>
              </div>
              {filteredEntries.map((entry) => (
                <div key={entry.username} className="review-row" role="listitem">
                  <span className="review-detail-stack">
                    <strong>{entry.username}</strong>
                    <span className="assistive-copy">
                      {entry.role === ROLE_ADMIN
                        ? "Admin"
                        : entry.role === ROLE_MODERATOR
                          ? "Moderator"
                          : "User"}
                    </span>
                  </span>
                  <span>
                    <label className="sr-only" htmlFor={`role-${entry.username}`}>
                      Role for {entry.username}
                    </label>
                    <select
                      id={`role-${entry.username}`}
                      value={roleValues[entry.username] ?? entry.role}
                      onChange={(event) =>
                        setRoleValues((current) => ({
                          ...current,
                          [entry.username]: event.target.value
                        }))
                      }
                    >
                      <option value={ROLE_USER}>User</option>
                      <option value={ROLE_MODERATOR}>Moderator</option>
                      <option value={ROLE_ADMIN}>Admin</option>
                    </select>
                  </span>
                  <span className="review-detail-stack">
                    <span
                      className={`score-badge ${
                        entry.isBanned ? "score-badge-high" : "score-badge-low"
                      }`}
                    >
                      {entry.isBanned ? "banned" : "active"}
                    </span>
                    {entry.isBanned && (
                      <span className="assistive-copy">
                        Since {formatTimestamp(entry.bannedAt)}
                      </span>
                    )}
                  </span>
                  <span>{formatTimestamp(entry.createdAt)}</span>
                  <span className="review-detail-stack">
                    <div className="actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={rowStatuses[entry.username] === "submitting"}
                        onClick={() => void handleRoleSave(entry)}
                      >
                        Save role
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={rowStatuses[entry.username] === "submitting"}
                        onClick={() => void handleBanToggle(entry)}
                      >
                        {entry.isBanned ? "Unban" : "Ban"}
                      </button>
                    </div>
                    {rowMessages[entry.username] && (
                      <span
                        className={`assistive-copy ${
                          rowStatuses[entry.username] === "error" ? "error-copy" : "success-copy"
                        }`}
                      >
                        {rowMessages[entry.username]}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
