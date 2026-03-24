"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  fetchCurrentUser,
  roleAllows,
  ROLE_ADMIN,
  ROLE_MODERATOR,
  type AuthUser
} from "../lib/api";
import { useLocale } from "../lib/locale";

export default function HomePage() {
  const { messages } = useLocale();
  const uiText = messages.home;
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
      <div className="content-card home-card">
        <p className="eyebrow">{uiText.eyebrow}</p>
        <h1 className="sr-only">{uiText.title}</h1>
        <p className="sr-only">{uiText.description}</p>
        <div className="home-mascot-shell" aria-hidden="true">
          <Image
            src="/assets/3d-maze/rat.png"
            alt=""
            width={128}
            height={128}
            className="home-mascot"
            priority
          />
        </div>
        <div className="actions page-actions">
          <Link href="/play" className="primary-link">
            {uiText.actions.launchChallenge}
          </Link>
          <Link href="/history" className="secondary-link">
            {uiText.actions.openArchive}
          </Link>
          {canAccessReviews && (
            <Link href="/admin/reviews" className="secondary-link">
              {uiText.actions.reviewQueue}
            </Link>
          )}
          {roleAllows(user?.role, ROLE_ADMIN) && (
            <Link href="/admin/users" className="secondary-link">
              {uiText.actions.userManager}
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
