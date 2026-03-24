"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";

import { formatElapsedTime } from "../../lib/game/maze";
import { useLocale } from "../../lib/locale";

export interface MetadataItem {
  label: string;
  value: ReactNode;
}

interface MetadataListProps {
  items: MetadataItem[];
}

interface ArchiveNavigatorProps {
  archiveDate: string;
}

interface RunTimerValueProps {
  runStartTime: number | null;
  finishTime: number | null;
}

export function RunTimerValue({ runStartTime, finishTime }: RunTimerValueProps) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!runStartTime || finishTime) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 50);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [finishTime, runStartTime]);

  if (!runStartTime) {
    return <>{formatElapsedTime(0)}</>;
  }

  if (finishTime) {
    return <>{formatElapsedTime(finishTime - runStartTime)}</>;
  }

  return <>{formatElapsedTime(Math.max(0, now - runStartTime))}</>;
}

export function PlaySkeleton() {
  return (
    <>
      <section className="maze-summary play-summary play-loading-shell" aria-hidden="true">
        <div className="play-focus-layout">
          <div className="play-focus-sidebar">
            <div className="gameplay-hud gameplay-hud-loading">
              <div className="gameplay-hud-item gameplay-hud-item-primary play-skeleton-block" />
              <div className="gameplay-hud-item play-skeleton-block" />
              <div className="gameplay-hud-item play-skeleton-block" />
            </div>
            <div className="gameplay-controls play-skeleton-line" />
            <div className="actions play-focus-actions">
              <span className="secondary-button play-skeleton-button" />
              <span className="secondary-button play-skeleton-button" />
            </div>
            <div className="play-status-stack">
              <div className="play-win-state play-skeleton-block play-skeleton-status" />
            </div>
          </div>
          <div className="play-focus-main">
            <div className="raycast-panel raycast-panel-loading">
              <div className="raycast-canvas raycast-canvas-loading" />
            </div>
          </div>
        </div>
      </section>
      <div className="play-side-panels play-side-panels-loading" aria-hidden="true">
        <div className="play-side-panel">
          <section className="maze-summary play-loading-panel">
            <h2 className="section-title play-skeleton-title" />
            <div className="play-skeleton-list">
              <div className="play-skeleton-row" />
              <div className="play-skeleton-row" />
              <div className="play-skeleton-row" />
            </div>
          </section>
        </div>
        <div className="play-side-panel">
          <section className="maze-summary play-loading-panel">
            <h2 className="section-title play-skeleton-title" />
            <div className="play-skeleton-form">
              <div className="play-skeleton-line" />
              <div className="play-skeleton-line" />
              <div className="play-skeleton-line" />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export function MetadataList({ items }: MetadataListProps) {
  return (
    <dl className="metadata-list">
      {items.map((item) => (
        <div key={item.label} className="metadata-row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function shiftArchiveDate(date: string, days: number): string {
  const parts = date.split("-").map(Number);
  const shiftedDate = new Date(Date.UTC(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1));
  shiftedDate.setUTCDate(shiftedDate.getUTCDate() + days);
  return shiftedDate.toISOString().slice(0, 10);
}

export function ArchiveNavigator({ archiveDate }: ArchiveNavigatorProps) {
  const { messages } = useLocale();
  const uiText = messages.play;
  const previousDate = shiftArchiveDate(archiveDate, -1);
  const nextDate = shiftArchiveDate(archiveDate, 1);
  const todayDate = new Date().toISOString().slice(0, 10);
  const canAdvance = nextDate <= todayDate;
  const isToday = archiveDate === todayDate;

  return (
    <section className="maze-summary archive-nav" aria-labelledby="archive-nav-title">
      <h2 id="archive-nav-title" className="section-title">
        {uiText.archiveTitle}
      </h2>
      <p className="body-copy">{uiText.archiveBody}</p>
      <div className="actions">
        <Link href={`/play?date=${previousDate}`} className="secondary-link">
          {uiText.archiveActions.previousDay}
        </Link>
        {canAdvance ? (
          <Link href={`/play?date=${nextDate}`} className="secondary-link">
            {uiText.archiveActions.nextDay}
          </Link>
        ) : (
          <span className="secondary-link is-disabled" aria-disabled="true">
            {uiText.archiveActions.nextDay}
          </span>
        )}
        {!isToday && (
          <Link href="/play" className="primary-link">
            {uiText.archiveActions.jumpToToday}
          </Link>
        )}
      </div>
    </section>
  );
}
