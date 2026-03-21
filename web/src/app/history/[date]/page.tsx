"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  fetchHistoryDay,
  type HistoryDayResponse
} from "../../../lib/api";
import { formatElapsedTime } from "../../../lib/game/maze";

type PageStatus = "loading" | "success" | "error";

export default function HistoryDayPage() {
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

  return (
    <main className="page-shell">
      <div className="content-card">
        <p className="eyebrow">Archive Day</p>
        <h1>{date || "Daily challenge detail"}</h1>

        {status === "loading" && (
          <p className="body-copy status-copy" aria-live="polite">
            Loading archived challenge...
          </p>
        )}

        {status === "error" && (
          <p className="body-copy status-copy error-copy" aria-live="assertive">
            Unable to load that archived challenge right now.
          </p>
        )}

        {status === "success" && payload && (
          <>
            <section className="maze-summary" aria-labelledby="archive-challenge-title">
              <h2 id="archive-challenge-title" className="section-title">
                Challenge details
              </h2>
              <dl className="metadata-list">
                <div className="metadata-row">
                  <dt>Date</dt>
                  <dd>{payload.challenge.date}</dd>
                </div>
                <div className="metadata-row">
                  <dt>Title</dt>
                  <dd>{payload.challenge.title}</dd>
                </div>
                <div className="metadata-row">
                  <dt>Seed</dt>
                  <dd>
                    <code>{payload.challenge.seed}</code>
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>Maze size</dt>
                  <dd>
                    {payload.challenge.size.width} x {payload.challenge.size.height}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>Start</dt>
                  <dd>
                    ({payload.challenge.start.x}, {payload.challenge.start.y})
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>Exit</dt>
                  <dd>
                    ({payload.challenge.exit.x}, {payload.challenge.exit.y})
                  </dd>
                </div>
              </dl>
            </section>

            <section className="maze-summary" aria-labelledby="archive-leaderboard-title">
              <h2 id="archive-leaderboard-title" className="section-title">
                Leaderboard
              </h2>
              {payload.leaderboard.entries.length === 0 ? (
                <p className="body-copy">No submissions for this challenge yet.</p>
              ) : (
                <div className="leaderboard-list" aria-label="Archived daily leaderboard">
                  <div className="leaderboard-row leaderboard-row-header" aria-hidden="true">
                    <span>Rank</span>
                    <span>Player</span>
                    <span>Time</span>
                    <span>Moves</span>
                  </div>
                  {payload.leaderboard.entries.map((entry) => (
                    <div key={`${entry.rank}-${entry.acceptedAt}`} className="leaderboard-row">
                      <span>#{entry.rank}</span>
                      <span>
                        {entry.username ? (
                          <Link
                            href={`/profile/${entry.username}`}
                            className="inline-link"
                          >
                            {entry.username}
                          </Link>
                        ) : (
                          "Anonymous"
                        )}
                      </span>
                      <span>{formatElapsedTime(entry.elapsedTimeMs)}</span>
                      <span>{entry.moveCount}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <div className="actions">
          <Link href={`/play?date=${date}`} className="primary-link">
            Play this challenge
          </Link>
          <Link href="/history" className="primary-link">
            Back to history
          </Link>
          <Link href="/play" className="secondary-link">
            Open /play
          </Link>
        </div>
      </div>
    </main>
  );
}
