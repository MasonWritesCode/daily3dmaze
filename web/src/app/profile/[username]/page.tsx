"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import RoleBadge from "../../../components/RoleBadge";
import {
  fetchPlayerProfile,
  type PlayerProfile
} from "../../../lib/api";
import { formatElapsedTime } from "../../../lib/game/maze";
import { useLocale } from "../../../lib/locale";

type PageStatus = "loading" | "success" | "error";

export default function ProfilePage() {
  const { formatCount, formatDate, formatDateTime, formatDayCount, messages } = useLocale();
  const uiText = messages.profile;
  const params = useParams<{ username: string }>();
  const username = typeof params.username === "string" ? params.username.toLowerCase() : "";
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [status, setStatus] = useState<PageStatus>("loading");

  useEffect(() => {
    if (!username) {
      return;
    }

    let isMounted = true;

    async function loadProfile() {
      try {
        const payload = await fetchPlayerProfile(username);

        if (!isMounted) {
          return;
        }

        setProfile(payload);
        setStatus("success");
      } catch (error) {
        console.error("Failed to load player profile", error);

        if (!isMounted) {
          return;
        }

        setStatus("error");
      }
    }

    void loadProfile();

    return () => {
      isMounted = false;
    };
  }, [username]);

  return (
    <main className="page-shell">
      <div className="content-card">
        <p className="eyebrow">{uiText.eyebrow}</p>
        <h1>{username ? `${username}${uiText.titleSuffix}` : uiText.fallbackTitle}</h1>

        {status === "loading" && (
          <p className="body-copy status-copy" aria-live="polite">
            {uiText.loading}
          </p>
        )}

        {status === "error" && (
          <p className="body-copy status-copy error-copy" aria-live="assertive">
            {uiText.error}
          </p>
        )}

        {status === "success" && profile && (
          <>
            <section className="maze-summary" aria-labelledby="profile-overview-title">
              <h2 id="profile-overview-title" className="section-title">
                {uiText.overviewTitle}
              </h2>
              <dl className="metadata-list">
                <div className="metadata-row">
                  <dt>{uiText.labels.username}</dt>
                  <dd>
                    <span className="player-link-with-badge">
                      <code>{profile.user.username}</code>
                      <RoleBadge role={profile.user.role} labels={messages.play.auth.roles} />
                    </span>
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.labels.joined}</dt>
                  <dd>{formatDate(profile.user.createdAt)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.labels.totalRuns}</dt>
                  <dd>{formatCount(profile.stats.totalRuns)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.labels.daysPlayed}</dt>
                  <dd>{formatCount(profile.stats.daysPlayed)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.labels.bestTime}</dt>
                  <dd>
                    {profile.stats.bestElapsedTimeMs === null
                      ? uiText.emptyStats
                      : formatElapsedTime(profile.stats.bestElapsedTimeMs)}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.labels.averageTime}</dt>
                  <dd>
                    {profile.stats.averageElapsedTimeMs === null
                      ? uiText.emptyStats
                      : formatElapsedTime(profile.stats.averageElapsedTimeMs)}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.labels.lastPlayed}</dt>
                  <dd>
                    {profile.stats.lastPlayedAt === null
                      ? uiText.emptyStats
                      : formatDateTime(profile.stats.lastPlayedAt)}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.labels.currentStreak}</dt>
                  <dd>{formatDayCount(profile.stats.currentStreakDays)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.labels.bestStreak}</dt>
                  <dd>{formatDayCount(profile.stats.bestStreakDays)}</dd>
                </div>
              </dl>
            </section>

            <section className="maze-summary" aria-labelledby="recent-runs-title">
              <h2 id="recent-runs-title" className="section-title">
                {uiText.recentRunsTitle}
              </h2>
              {profile.recentRuns.length === 0 ? (
                <p className="body-copy">{uiText.noRuns}</p>
              ) : (
                <div
                  className="leaderboard-list"
                  role="list"
                  aria-label={uiText.labels.recentRunsLabel}
                >
                  <div className="leaderboard-row leaderboard-row-header" aria-hidden="true">
                    <span>{uiText.labels.recentRunDate}</span>
                    <span>{uiText.labels.recentRunSeed}</span>
                    <span>{uiText.labels.recentRunTime}</span>
                    <span>{uiText.labels.recentRunMoves}</span>
                  </div>
                  {profile.recentRuns.map((run) => (
                    <div
                      key={`${run.acceptedAt}-${run.seed}`}
                      className="leaderboard-row"
                      role="listitem"
                    >
                      <span>{run.date}</span>
                      <span>
                        <code>{run.seed}</code>
                      </span>
                      <span>{formatElapsedTime(run.elapsedTimeMs)}</span>
                      <span>{formatCount(run.moveCount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <div className="actions page-actions">
          <Link href="/play" className="secondary-link">
            {uiText.actions.backToPlay}
          </Link>
        </div>
      </div>
    </main>
  );
}
