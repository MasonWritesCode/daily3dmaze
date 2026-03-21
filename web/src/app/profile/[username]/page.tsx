"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import {
  fetchPlayerProfile,
  type PlayerProfile
} from "../../../lib/api";
import { formatElapsedTime } from "../../../lib/game/maze";

type PageStatus = "loading" | "success" | "error";

export default function ProfilePage() {
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
        <p className="eyebrow">Profile</p>
        <h1>{username ? `${username}'s runs` : "Player profile"}</h1>

        {status === "loading" && (
          <p className="body-copy status-copy" aria-live="polite">
            Loading profile...
          </p>
        )}

        {status === "error" && (
          <p className="body-copy status-copy error-copy" aria-live="assertive">
            Unable to load that profile right now.
          </p>
        )}

        {status === "success" && profile && (
          <>
            <section className="maze-summary" aria-labelledby="profile-overview-title">
              <h2 id="profile-overview-title" className="section-title">
                Overview
              </h2>
              <dl className="metadata-list">
                <div className="metadata-row">
                  <dt>Username</dt>
                  <dd>
                    <code>{profile.user.username}</code>
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>Joined</dt>
                  <dd>{new Date(profile.user.createdAt).toLocaleDateString()}</dd>
                </div>
                <div className="metadata-row">
                  <dt>Total runs</dt>
                  <dd>{profile.stats.totalRuns}</dd>
                </div>
                <div className="metadata-row">
                  <dt>Days played</dt>
                  <dd>{profile.stats.daysPlayed}</dd>
                </div>
                <div className="metadata-row">
                  <dt>Best time</dt>
                  <dd>
                    {profile.stats.bestElapsedTimeMs === null
                      ? "No completed runs yet"
                      : formatElapsedTime(profile.stats.bestElapsedTimeMs)}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>Average time</dt>
                  <dd>
                    {profile.stats.averageElapsedTimeMs === null
                      ? "No completed runs yet"
                      : formatElapsedTime(profile.stats.averageElapsedTimeMs)}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>Last played</dt>
                  <dd>
                    {profile.stats.lastPlayedAt === null
                      ? "No completed runs yet"
                      : new Date(profile.stats.lastPlayedAt).toLocaleString()}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>Current streak</dt>
                  <dd>{profile.stats.currentStreakDays} day(s)</dd>
                </div>
                <div className="metadata-row">
                  <dt>Best streak</dt>
                  <dd>{profile.stats.bestStreakDays} day(s)</dd>
                </div>
              </dl>
            </section>

            <section className="maze-summary" aria-labelledby="recent-runs-title">
              <h2 id="recent-runs-title" className="section-title">
                Recent runs
              </h2>
              {profile.recentRuns.length === 0 ? (
                <p className="body-copy">No attributed runs yet.</p>
              ) : (
                <div className="leaderboard-list" aria-label="Recent player runs">
                  <div className="leaderboard-row leaderboard-row-header" aria-hidden="true">
                    <span>Date</span>
                    <span>Seed</span>
                    <span>Time</span>
                    <span>Moves</span>
                  </div>
                  {profile.recentRuns.map((run) => (
                    <div
                      key={`${run.acceptedAt}-${run.seed}`}
                      className="leaderboard-row"
                    >
                      <span>{run.date}</span>
                      <span>
                        <code>{run.seed}</code>
                      </span>
                      <span>{formatElapsedTime(run.elapsedTimeMs)}</span>
                      <span>{run.moveCount}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <div className="actions">
          <Link href="/play" className="secondary-link">
            Back to /play
          </Link>
        </div>
      </div>
    </main>
  );
}
