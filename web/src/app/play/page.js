import Link from "next/link";

export default function PlayPage() {
  return (
    <main className="page-shell">
      <div className="content-card">
        <p className="eyebrow">Play</p>
        <h1>Maze gameplay placeholder</h1>
        <p className="body-copy">
          This route will become the daily challenge experience. For now, it is
          just confirming the app structure we want.
        </p>
        <p className="body-copy">
          Planned API base URL: <code>http://localhost:8080</code>
        </p>
        <div className="actions">
          <Link href="/" className="secondary-link">
            Back home
          </Link>
        </div>
      </div>
    </main>
  );
}
