import Link from "next/link";

export default function HomePage() {
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
        </div>
      </div>
    </main>
  );
}
