"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "../admin.module.css";

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
import { useLocale } from "../../../lib/locale";
import {
  filterAdminUserEntries,
  getLocalizedAdminRoleLabel
} from "./helpers";

void styles;

type PageStatus = "loading" | "ready" | "error";
type RowStatus = "idle" | "submitting" | "success" | "error";

export default function AdminUsersPage() {
  const { formatCount, formatDateTime, messages } = useLocale();
  const uiText = messages.adminUsers;
  const [status, setStatus] = useState<PageStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [entries, setEntries] = useState<AdminUserEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [roleValues, setRoleValues] = useState<Record<string, string>>({});
  const [rowStatuses, setRowStatuses] = useState<Record<string, RowStatus>>({});
  const [rowMessages, setRowMessages] = useState<Record<string, string>>({});
  const resultsCountId = "admin-user-results";

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

  const filteredEntries = useMemo(
    () => filterAdminUserEntries(entries, searchQuery),
    [entries, searchQuery]
  );

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
        [entry.username]: uiText.rowMessages.roleUpdated.replace(
          "{role}",
          getLocalizedAdminRoleLabel(result.role, uiText.labels)
        )
      }));
    } catch (error) {
      setRowStatuses((current) => ({ ...current, [entry.username]: "error" }));
      setRowMessages((current) => ({
        ...current,
        [entry.username]:
          error instanceof Error ? error.message : uiText.rowMessages.roleError
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
          ? uiText.rowMessages.userBanned
          : uiText.rowMessages.userUnbanned
      }));
    } catch (error) {
      setRowStatuses((current) => ({ ...current, [entry.username]: "error" }));
      setRowMessages((current) => ({
        ...current,
        [entry.username]:
          error instanceof Error ? error.message : uiText.rowMessages.banError
      }));
    }
  }

  return (
    <main className="page-shell">
      <div className="content-card content-card-wide">
        <p className="eyebrow">{uiText.eyebrow}</p>
        <h1>{uiText.title}</h1>
        <p className="body-copy">{uiText.intro}</p>
        <div className="actions admin-page-toolbar admin-users-toolbar">
          <Link href="/admin/reviews" className="primary-link">
            {uiText.actions.reviewQueue}
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
              {uiText.forbiddenBodyPrefix}{" "}
              <code>{getLocalizedAdminRoleLabel(user.role, uiText.labels)}</code>.{" "}
              {uiText.forbiddenBodySuffix}
            </p>
          </section>
        )}

        {status === "ready" && user && roleAllows(user.role, ROLE_ADMIN) && (
          <section className="maze-summary admin-panel-section" aria-labelledby="user-list-title">
            <h2 id="user-list-title" className="section-title">
              {uiText.usersTitle}
            </h2>
            <p className="assistive-copy admin-users-signed-in">
              {uiText.signedInAs} <strong>{user.username}</strong>.
            </p>

            <label className="auth-field" htmlFor="user-search">
              <span>{uiText.searchLabel}</span>
              <input
                id="user-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={uiText.searchPlaceholder}
                aria-describedby={resultsCountId}
              />
            </label>

            <p
              id={resultsCountId}
              className="assistive-copy admin-users-results"
              aria-live="polite"
            >
              {uiText.resultsShown
                .replace("{count}", formatCount(filteredEntries.length))
                .replace("{suffix}", filteredEntries.length === 1 ? "" : "s")}
            </p>

            <div className="review-list admin-users-list" role="list" aria-label={uiText.listLabel}>
              <div
                className="review-row review-row-header admin-user-row admin-user-row-header admin-users-list-header"
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
                  className="review-row admin-user-row admin-user-card"
                  role="listitem"
                >
                  <span className="review-detail-stack admin-user-identity admin-user-cell">
                    <strong>{entry.username}</strong>
                    <span className="assistive-copy">
                      {entry.role === ROLE_ADMIN
                        ? uiText.labels.admin
                        : entry.role === ROLE_MODERATOR
                          ? uiText.labels.moderator
                          : uiText.labels.standardUser}
                    </span>
                  </span>
                  <span className="admin-user-role-cell admin-user-cell">
                    <label className="sr-only" htmlFor={`role-${entry.username}`}>
                      {uiText.selectorLabels.roleForUser.replace("{username}", entry.username)}
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
                      <option value={ROLE_USER}>{uiText.labels.standardUser}</option>
                      <option value={ROLE_MODERATOR}>{uiText.labels.moderator}</option>
                      <option value={ROLE_ADMIN}>{uiText.labels.admin}</option>
                    </select>
                  </span>
                  <span className="review-detail-stack admin-user-status-cell admin-user-cell">
                    <span
                      className={`score-badge ${
                        entry.isBanned ? "score-badge-high" : "score-badge-low"
                      }`}
                    >
                      {entry.isBanned ? uiText.labels.banned : uiText.labels.active}
                    </span>
                    {entry.isBanned && (
                      <span className="assistive-copy">
                        {uiText.timestamps.since}{" "}
                        {entry.bannedAt
                          ? formatDateTime(entry.bannedAt)
                          : uiText.timestamps.notRecorded}
                      </span>
                    )}
                  </span>
                  <span className="admin-user-created-cell admin-user-cell">
                    {formatDateTime(entry.createdAt)}
                  </span>
                  <span className="review-detail-stack admin-user-actions-cell admin-user-cell">
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
