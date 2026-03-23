"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchHistory, type HistoryEntry } from "../../lib/api";
import { formatElapsedTime } from "../../lib/game/maze";

type PageStatus = "loading" | "success" | "error";

const uiText = {
  eyebrow: "History",
  title: "Daily challenge archive",
  intro:
    "Browse recent daily mazes, see how many runs each day received, and inspect the current best result for each challenge.",
  loading: "Loading challenge history...",
  error: "Unable to load the challenge history right now.",
  sectionTitle: "Recent daily challenges",
  listLabel: "Daily challenge history",
  empty: "No archived challenges are available yet.",
  labels: {
    seed: "Seed",
    size: "Maze size",
    bestRun: "Best run"
  },
  actions: {
    openPlay: "Play today’s challenge",
    backHome: "Return to desktop"
  },
  bestRunNoSubmissions: "No submissions yet"
} as const;

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [status, setStatus] = useState<PageStatus>("loading");

  useEffect(() => {
    let isMounted = true;

    async function loadHistory() {
      try {
        const payload = await fetchHistory();

        if (!isMounted) {
          return;
        }

        setEntries(payload.entries);
        setStatus("success");
      } catch (error) {
        console.error("Failed to load history", error);

        if (!isMounted) {
          return;
        }

        setStatus("error");
      }
    }

    void loadHistory();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="page-shell">
      <div className="content-card">
        <p className="eyebrow">History</p>
        <h1>{uiText.title}</h1>
        <p className="body-copy">{uiText.intro}</p>

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

        {status === "success" && (
          <section className="maze-summary" aria-labelledby="history-title">
            <h2 id="history-title" className="section-title">
              {uiText.sectionTitle}
            </h2>
            {entries.length === 0 ? (
              <p className="body-copy">{uiText.empty}</p>
            ) : (
            <div className="history-list" role="list" aria-label={uiText.listLabel}>
              {entries.map((entry) => (
                <article key={entry.date} className="history-card" role="listitem">
                  <div className="history-card-header">
                    <div>
                      <p className="body-copy history-date">
                        <Link href={`/history/${entry.date}`} className="inline-link">
                          {entry.date}
                        </Link>
                      </p>
                      <p className="body-copy history-title">
                        <Link href={`/history/${entry.date}`} className="inline-link">
                          {entry.title}
                        </Link>
                      </p>
                    </div>
                    <span className="history-chip">
                      {entry.submissionCount} run{entry.submissionCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <dl className="metadata-list">
                    <div className="metadata-row">
                      <dt>{uiText.labels.seed}</dt>
                      <dd>
                        <code>{entry.seed}</code>
                      </dd>
                    </div>
                    <div className="metadata-row">
                      <dt>{uiText.labels.size}</dt>
                      <dd>
                        {entry.size.width} x {entry.size.height}
                      </dd>
                    </div>
                    <div className="metadata-row">
                      <dt>{uiText.labels.bestRun}</dt>
                      <dd>
                        {entry.bestRun ? (
                          <>
                            {entry.bestRun.username ? (
                              <Link
                                href={`/profile/${entry.bestRun.username}`}
                                className="inline-link"
                              >
                                {entry.bestRun.username}
                              </Link>
                            ) : (
                              "Anonymous"
                            )}{" "}
                            in {formatElapsedTime(entry.bestRun.elapsedTimeMs)} with{" "}
                            {entry.bestRun.moveCount} moves
                          </>
                        ) : (
                          uiText.bestRunNoSubmissions
                        )}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
            )}
          </section>
        )}

        <div className="actions">
          <Link href="/play" className="primary-link">
            {uiText.actions.openPlay}
          </Link>
          <Link href="/" className="secondary-link">
            {uiText.actions.backHome}
          </Link>
        </div>
      </div>
    </main>
  );
}
