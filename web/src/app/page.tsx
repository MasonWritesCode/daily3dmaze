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
      <div className="content-card home-card">
        <p className="eyebrow">daily3dmaze.exe</p>
        <h1 className="sr-only">daily3dmaze home</h1>
        <p className="sr-only">
          Launch the daily maze challenge, browse the archive, or open internal
          tools depending on your account role.
        </p>
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
