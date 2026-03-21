"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchHistory, type HistoryEntry } from "../../lib/api";
import { formatElapsedTime } from "../../lib/game/maze";

type PageStatus = "loading" | "success" | "error";

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
        <h1>Daily challenge archive</h1>
        <p className="body-copy">
          Browse recent daily mazes, see how many runs each day received, and
          inspect the current best result for each challenge.
        </p>

        {status === "loading" && (
          <p className="body-copy status-copy" aria-live="polite">
            Loading challenge history...
          </p>
        )}

        {status === "error" && (
          <p className="body-copy status-copy error-copy" aria-live="assertive">
            Unable to load the challenge history right now.
          </p>
        )}

        {status === "success" && (
          <section className="maze-summary" aria-labelledby="history-title">
            <h2 id="history-title" className="section-title">
              Recent daily challenges
            </h2>
            <div className="history-list" aria-label="Daily challenge history">
              {entries.map((entry) => (
                <article key={entry.date} className="history-card">
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
                      <dt>Seed</dt>
                      <dd>
                        <code>{entry.seed}</code>
                      </dd>
                    </div>
                    <div className="metadata-row">
                      <dt>Maze size</dt>
                      <dd>
                        {entry.size.width} x {entry.size.height}
                      </dd>
                    </div>
                    <div className="metadata-row">
                      <dt>Best run</dt>
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
                          "No submissions yet"
                        )}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>
        )}

        <div className="actions">
          <Link href="/play" className="primary-link">
            Open /play
          </Link>
          <Link href="/" className="secondary-link">
            Back home
          </Link>
        </div>
      </div>
    </main>
  );
}
