"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import RoleBadge from "../../../components/RoleBadge";
import {
  fetchHistoryDay,
  type HistoryDayResponse
} from "../../../lib/api";
import { formatElapsedTime } from "../../../lib/game/maze";
import { useLocale } from "../../../lib/locale";

type PageStatus = "loading" | "success" | "error";

export default function HistoryDayPage() {
  const { formatCount, messages } = useLocale();
  const uiText = messages.historyDay;
  const params = useParams<{ date: string }>();
  const date = typeof params.date === "string" ? params.date : "";
  const [payload, setPayload] = useState<HistoryDayResponse | null>(null);
  const [status, setStatus] = useState<PageStatus>("loading");

  useEffect(() => {
    if (!date) {
      return;
    }

    let isMounted = true;

    async function loadArchiveDay() {
      try {
        const response = await fetchHistoryDay(date);

        if (!isMounted) {
          return;
        }

        setPayload(response);
        setStatus("success");
      } catch (error) {
        console.error("Failed to load archive day", error);

        if (!isMounted) {
          return;
        }

        setStatus("error");
      }
    }

    void loadArchiveDay();

    return () => {
      isMounted = false;
    };
  }, [date]);

  function getDisplayTitle(title: string): string {
    return title === "Daily Maze" ? uiText.defaultChallengeTitle : title;
  }

  return (
    <main className="page-shell">
      <div className="content-card">
        <p className="eyebrow">{uiText.eyebrow}</p>
        <h1>{date || uiText.fallbackTitle}</h1>

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

        {status === "success" && payload && (
          <>
            <section className="maze-summary" aria-labelledby="archive-challenge-title">
              <h2 id="archive-challenge-title" className="section-title">
                {uiText.detailsTitle}
              </h2>
              <dl className="metadata-list">
                <div className="metadata-row">
                  <dt>{uiText.labels.date}</dt>
                  <dd>{payload.challenge.date}</dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.labels.title}</dt>
                  <dd>{getDisplayTitle(payload.challenge.title)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.labels.seed}</dt>
                  <dd>
                    <code>{payload.challenge.seed}</code>
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.labels.size}</dt>
                  <dd>
                    {payload.challenge.size.width} x {payload.challenge.size.height}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.labels.start}</dt>
                  <dd>
                    ({payload.challenge.start.x}, {payload.challenge.start.y})
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.labels.exit}</dt>
                  <dd>
                    ({payload.challenge.exit.x}, {payload.challenge.exit.y})
                  </dd>
                </div>
              </dl>
            </section>

            <section className="maze-summary" aria-labelledby="archive-leaderboard-title">
              <h2 id="archive-leaderboard-title" className="section-title">
                {uiText.leaderboardTitle}
              </h2>
              {payload.leaderboard.entries.length === 0 ? (
                <p className="body-copy">{uiText.leaderboardEmpty}</p>
              ) : (
                <div className="leaderboard-list" role="list" aria-label={uiText.leaderboardLabel}>
                  <div className="leaderboard-row leaderboard-row-header" aria-hidden="true">
                    <span>{uiText.labels.rank}</span>
                    <span>{uiText.labels.player}</span>
                    <span>{uiText.labels.time}</span>
                    <span>{uiText.labels.moves}</span>
                  </div>
                  {payload.leaderboard.entries.map((entry) => (
                    <div
                      key={`${entry.rank}-${entry.acceptedAt}`}
                      className="leaderboard-row"
                      role="listitem"
                    >
                      <span>#{entry.rank}</span>
                      <span>
                        {entry.username ? (
                          <span className="player-link-with-badge">
                            <Link
                              href={`/profile/${entry.username}`}
                              className="inline-link"
                            >
                              {entry.username}
                            </Link>
                            <RoleBadge role={entry.role} labels={messages.play.auth.roles} />
                          </span>
                        ) : (
                          uiText.anonymous
                        )}
                      </span>
                      <span>{formatElapsedTime(entry.elapsedTimeMs)}</span>
                      <span>{formatCount(entry.moveCount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <div className="actions">
          <Link href={`/play?date=${date}`} className="primary-link">
            {uiText.actions.play}
          </Link>
          <Link href="/history" className="primary-link">
            {uiText.actions.backToHistory}
          </Link>
          <Link href="/play" className="secondary-link">
            {uiText.actions.openPlay}
          </Link>
        </div>
      </div>
    </main>
  );
}
