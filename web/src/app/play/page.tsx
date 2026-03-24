"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./play.module.css";

import {
  fetchCurrentUser,
  fetchDailyMaze,
  type AuthUser
} from "../../lib/api";
import type { DailyMaze } from "../../lib/game/maze";
import { useLocale } from "../../lib/locale";
import { ArchiveNavigator, PlaySkeleton } from "./PlayChrome";
import MazeSessionView from "./MazeSessionView";

const PlaySidebarPanels = dynamic(() => import("./PlaySidebarPanels"), {
  ssr: false,
  loading: () => <div className="play-side-panels play-side-panels-loading" aria-hidden="true" />
});
void styles;

type AsyncStatus = "idle" | "loading" | "success" | "error";
type AuthStatus = "loading" | "authenticated" | "unauthenticated";

function PlayPageContent() {
  const { messages } = useLocale();
  const uiText = messages.play;
  const searchParams = useSearchParams();
  const archiveDate = searchParams.get("date") ?? "";
  const [maze, setMaze] = useState<DailyMaze | null>(null);
  const [status, setStatus] = useState<AsyncStatus>("loading");
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState<number>(0);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [isCompactLandscape, setIsCompactLandscape] = useState<boolean>(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 960px) and (orientation: landscape)");
    const sync = () => setIsCompactLandscape(mediaQuery.matches);

    sync();
    mediaQuery.addEventListener("change", sync);
    return () => {
      mediaQuery.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadMaze() {
      try {
        const payload = await fetchDailyMaze(archiveDate || undefined);

        if (!isMounted) {
          return;
        }

        setMaze(payload);
        setStatus("success");
      } catch (error) {
        console.error("Failed to load daily maze metadata", error);

        if (!isMounted) {
          return;
        }

        setStatus("error");
      }
    }

    void loadMaze();

    return () => {
      isMounted = false;
    };
  }, [archiveDate]);

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentUser() {
      try {
        const currentUser = await fetchCurrentUser();

        if (!isMounted) {
          return;
        }

        setUser(currentUser);
        setAuthStatus(currentUser ? "authenticated" : "unauthenticated");
      } catch (error) {
        console.error("Failed to load current user", error);

        if (!isMounted) {
          return;
        }

        setUser(null);
        setAuthStatus("unauthenticated");
      }
    }

    void loadCurrentUser();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="page-shell">
      <div className="content-card content-card-wide play-window">
        <p className="eyebrow">{uiText.eyebrow}</p>
        <h1 className="sr-only">{uiText.title}</h1>
        {archiveDate && (
          <p className="body-copy body-copy-strong">
            {uiText.archiveViewing} <code>{archiveDate}</code>.
          </p>
        )}
        {archiveDate &&
          (isCompactLandscape ? (
            <details className="play-secondary-details">
              <summary>{uiText.archivePanelTitle}</summary>
              <div className="play-secondary-details-body">
                <ArchiveNavigator archiveDate={archiveDate} />
              </div>
            </details>
          ) : (
            <ArchiveNavigator archiveDate={archiveDate} />
          ))}

        {status === "loading" && (
          <>
            <p className="body-copy status-copy" aria-live="polite">
              {uiText.loadingMaze}
            </p>
            <PlaySkeleton />
          </>
        )}

        {status === "success" && maze && (
          <MazeSessionView
            maze={maze}
            userRole={user?.role}
            onRunSubmitted={() =>
              setLeaderboardRefreshKey((currentKey) => currentKey + 1)
            }
          />
        )}

        {status === "success" && maze && (
          <PlaySidebarPanels
            mazeDate={maze.date}
            user={user}
            authStatus={authStatus}
            leaderboardRefreshKey={leaderboardRefreshKey}
            isCompactLandscape={isCompactLandscape}
            onAuthChange={(nextUser) => {
              setUser(nextUser);
              setAuthStatus(nextUser ? "authenticated" : "unauthenticated");
              setLeaderboardRefreshKey((currentKey) => currentKey + 1);
            }}
          />
        )}

        {status === "error" && (
          <p className="body-copy status-copy error-copy" aria-live="assertive">
            {uiText.mazeError}
          </p>
        )}

        <div className="actions">
          <Link href="/history" className="secondary-link">
            {uiText.actions.challengeArchive}
          </Link>
          <Link href="/" className="secondary-link">
            {uiText.actions.backHome}
          </Link>
        </div>
        <div className="window-footer" aria-label={uiText.gameplay.statusBar}>
          <span>{uiText.systemBar}</span>
          <span>
            {archiveDate
              ? `${uiText.archiveStatusPrefix} ${archiveDate}`
              : uiText.archiveStatusToday}
          </span>
        </div>
      </div>
    </main>
  );
}

export default function PlayPage() {
  const { messages } = useLocale();
  const uiText = messages.play;
  return (
    <Suspense
      fallback={
        <main className="page-shell">
          <div className="content-card content-card-wide play-window">
            <p className="eyebrow">{uiText.eyebrow}</p>
            <h1>{uiText.title}</h1>
            <p className="body-copy status-copy" aria-live="polite">
              {uiText.loadingMaze}
            </p>
            <PlaySkeleton />
          </div>
        </main>
      }
    >
      <PlayPageContent />
    </Suspense>
  );
}
