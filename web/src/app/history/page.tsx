"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchHistory, type HistoryEntry } from "../../lib/api";
import { formatElapsedTime } from "../../lib/game/maze";
import { useLocale } from "../../lib/locale";

type PageStatus = "loading" | "success" | "error";

export default function HistoryPage() {
  const { formatCount, messages } = useLocale();
  const uiText = messages.history;
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

  function getDisplayTitle(title: string): string {
    return title === "Daily Maze" ? uiText.defaultChallengeTitle : title;
  }

  return (
    <main className="page-shell">
      <div className="content-card">
        <p className="eyebrow">{uiText.eyebrow}</p>
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
                          {getDisplayTitle(entry.title)}
                        </Link>
                      </p>
                    </div>
                    <span className="history-chip">
                      {(entry.submissionCount === 1
                        ? uiText.submissionCount.one
                        : uiText.submissionCount.other
                      ).replace("{count}", formatCount(entry.submissionCount))}
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
                            {uiText.bestRunSummary
                              .replace(
                                "{player}",
                                entry.bestRun.username ?? uiText.anonymous
                              )
                              .replace(
                                "{elapsed}",
                                formatElapsedTime(entry.bestRun.elapsedTimeMs)
                              )
                              .replace(
                                "{moves}",
                                formatCount(entry.bestRun.moveCount)
                              )
                              .split(entry.bestRun.username ?? uiText.anonymous)
                              .map((segment, index, segments) => (
                                <span key={`${entry.date}-best-run-${index}`}>
                                  {segment}
                                  {index < segments.length - 1 &&
                                    (entry.bestRun?.username ? (
                                      <Link
                                        href={`/profile/${entry.bestRun.username}`}
                                        className="inline-link"
                                      >
                                        {entry.bestRun.username}
                                      </Link>
                                    ) : (
                                      uiText.anonymous
                                    ))}
                                </span>
                              ))}
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
