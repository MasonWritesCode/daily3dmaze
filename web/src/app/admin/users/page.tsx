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

const uiText = {
  eyebrow: "Internal tooling",
  title: "User management",
  intro: "Admins can grant or revoke moderator access and ban or unban accounts.",
  loading: "Loading users...",
  error: "Unable to load admin users.",
  authRequiredTitle: "Sign in required",
  authRequiredBody: "Admin user management requires an authenticated session.",
  forbiddenTitle: "Admin access required",
  usersTitle: "Accounts",
  searchLabel: "Search users",
  searchPlaceholder: "Search by username, role, or status",
  listLabel: "Managed users",
  actions: {
    backToReviews: "Back to reviews",
    backToPlay: "Return to challenge",
    saveRole: "Save role",
    ban: "Ban",
    unban: "Unban"
  },
  labels: {
    user: "User",
    role: "Role",
    status: "Status",
    created: "Created",
    actions: "Actions",
    active: "active",
    banned: "banned",
    admin: "Admin",
    moderator: "Moderator"
  }
} as const;

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
        <h1>{uiText.title}</h1>
        <p className="body-copy">{uiText.intro}</p>
        <div className="actions">
          <Link href="/admin/reviews" className="primary-link">
            Review queue
          </Link>
          <Link href="/play" className="secondary-link">
            {uiText.actions.backToPlay}
          </Link>
        </div>

        {status === "loading" && (
          <p className="status-copy" aria-live="polite">
            {uiText.loading}
          </p>
        )}

        {status === "error" && errorMessage && (
          <p className="status-copy error-copy" role="alert">
            {errorMessage || uiText.error}
          </p>
        )}

        {status === "ready" && !user && (
          <section className="maze-summary" aria-labelledby="users-auth-title">
            <h2 id="users-auth-title" className="section-title">
              {uiText.authRequiredTitle}
            </h2>
            <p className="body-copy">{uiText.authRequiredBody}</p>
          </section>
        )}

        {status === "ready" && user && !roleAllows(user.role, ROLE_ADMIN) && (
          <section className="maze-summary" aria-labelledby="users-forbidden-title">
            <h2 id="users-forbidden-title" className="section-title">
              {uiText.forbiddenTitle}
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
                  {uiText.usersTitle}
                </h2>
                <p className="assistive-copy">
                  Signed in as <strong>{user.username}</strong>.
                </p>
              </div>
            </div>

            <label className="auth-field" htmlFor="user-search">
              <span>{uiText.searchLabel}</span>
              <input
                id="user-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={uiText.searchPlaceholder}
              />
            </label>

            <p className="assistive-copy" aria-live="polite">
              {filteredEntries.length} user{filteredEntries.length === 1 ? "" : "s"} shown
            </p>

            <div className="review-list" role="list" aria-label={uiText.listLabel}>
              <div
                className="review-row review-row-header admin-user-row admin-user-row-header"
                role="listitem"
                aria-hidden="true"
              >
                <span>{uiText.labels.user}</span>
                <span>{uiText.labels.role}</span>
                <span>{uiText.labels.status}</span>
                <span>{uiText.labels.created}</span>
                <span>{uiText.labels.actions}</span>
              </div>
              {filteredEntries.map((entry) => (
                <div
                  key={entry.username}
                  className="review-row admin-user-row"
                  role="listitem"
                >
                  <span className="review-detail-stack">
                    <strong>{entry.username}</strong>
                    <span className="assistive-copy">
                      {entry.role === ROLE_ADMIN
                        ? uiText.labels.admin
                        : entry.role === ROLE_MODERATOR
                          ? uiText.labels.moderator
                          : uiText.labels.user}
                    </span>
                  </span>
                  <span className="admin-user-role-cell">
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
                  <span className="review-detail-stack admin-user-status-cell">
                    <span
                      className={`score-badge ${
                        entry.isBanned ? "score-badge-high" : "score-badge-low"
                      }`}
                    >
                      {entry.isBanned ? uiText.labels.banned : uiText.labels.active}
                    </span>
                    {entry.isBanned && (
                      <span className="assistive-copy">
                        Since {formatTimestamp(entry.bannedAt)}
                      </span>
                    )}
                  </span>
                  <span className="admin-user-created-cell">{formatTimestamp(entry.createdAt)}</span>
                  <span className="review-detail-stack admin-user-actions-cell">
                    <div className="actions admin-user-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={rowStatuses[entry.username] === "submitting"}
                        onClick={() => void handleRoleSave(entry)}
                      >
                        {uiText.actions.saveRole}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={rowStatuses[entry.username] === "submitting"}
                        onClick={() => void handleBanToggle(entry)}
                      >
                        {entry.isBanned ? uiText.actions.unban : uiText.actions.ban}
                      </button>
                    </div>
                    {rowMessages[entry.username] && (
                      <span
                        aria-live="polite"
                        className={`assistive-copy admin-user-message ${
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
