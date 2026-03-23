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
        <p className="eyebrow">daily3dmaze</p>
        <h1>Daily first-person maze challenge.</h1>
        <p className="body-copy">Hello World</p>
        <div className="actions">
          <Link href="/play" className="primary-link">
            Open /play
          </Link>
          <Link href="/history" className="secondary-link">
            Browse history
          </Link>
          {canAccessReviews && (
            <Link href="/admin/reviews" className="secondary-link">
              Internal reviews
            </Link>
          )}
          {roleAllows(user?.role, ROLE_ADMIN) && (
            <Link href="/admin/users" className="secondary-link">
              Manage users
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
