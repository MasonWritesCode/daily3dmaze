"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  fetchCurrentUser,
  roleAllows,
  ROLE_ADMIN,
  ROLE_MODERATOR,
  type AuthUser
} from "../lib/api";

export default function HomePage() {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentUser() {
      try {
        const currentUser = await fetchCurrentUser();
        if (!isMounted) {
          return;
        }

        setUser(currentUser);
      } catch {
        if (!isMounted) {
          return;
        }

        setUser(null);
      }
    }

    void loadCurrentUser();

    return () => {
      isMounted = false;
    };
  }, []);

  const canAccessReviews = roleAllows(user?.role, ROLE_MODERATOR);

  return (
    <main className="page-shell">
      <div className="content-card">
        <p className="eyebrow">daily3dmaze.exe</p>
        <h1>Retro maze challenge for the browser.</h1>
        <p className="body-copy body-copy-strong">
          One first-person maze per day, with profiles, leaderboards, replay
          verification, and internal moderation tooling.
        </p>
        <section className="maze-summary home-status" aria-labelledby="home-status-title">
          <h2 id="home-status-title" className="section-title">
            System status
          </h2>
          <dl className="metadata-list">
            <div className="metadata-row">
              <dt>Challenge</dt>
              <dd>Daily seeded maze challenge is online.</dd>
            </div>
            <div className="metadata-row">
              <dt>Identity</dt>
              <dd>
                {user ? (
                  <>
                    Signed in as <code>{user.username}</code> with role{" "}
                    <code>{user.role}</code>.
                  </>
                ) : (
                  "Anonymous mode available. Sign in from /play to submit named runs."
                )}
              </dd>
            </div>
            <div className="metadata-row">
              <dt>Review tools</dt>
              <dd>
                Replay verification, queue health, and moderation workflows are part
                of the app itself.
              </dd>
            </div>
          </dl>
        </section>
        <div className="actions">
          <Link href="/play" className="primary-link">
            Launch challenge
          </Link>
          <Link href="/history" className="secondary-link">
            Open archive
          </Link>
          {canAccessReviews && (
            <Link href="/admin/reviews" className="secondary-link">
              Review queue
            </Link>
          )}
          {roleAllows(user?.role, ROLE_ADMIN) && (
            <Link href="/admin/users" className="secondary-link">
              User manager
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
