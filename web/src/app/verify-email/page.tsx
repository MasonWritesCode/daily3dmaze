"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { verifyEmail } from "../../lib/api";
import { useLocale } from "../../lib/locale";

type VerificationStatus = "idle" | "loading" | "success" | "error";

function VerifyEmailContent() {
  const { messages } = useLocale();
  const uiText = messages.play.emailVerification;
  const searchParams = useSearchParams();
  const token = (searchParams.get("token") ?? "").trim();
  const [status, setStatus] = useState<VerificationStatus>(token ? "loading" : "error");
  const [message, setMessage] = useState(token ? uiText.verifying : uiText.error);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage(uiText.error);
      return;
    }

    let cancelled = false;

    async function runVerification() {
      try {
        const response = await verifyEmail(token);
        if (cancelled) {
          return;
        }

        setStatus("success");
        setMessage(response.message || uiText.success);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setStatus("error");
        setMessage(error instanceof Error ? error.message : uiText.error);
      }
    }

    void runVerification();

    return () => {
      cancelled = true;
    };
  }, [token, uiText.error, uiText.success, uiText.verifying]);

  return (
    <section className="maze-summary" aria-labelledby="verify-email-title">
      <h2 id="verify-email-title" className="section-title">
        {uiText.title}
      </h2>
      <p
        className={`body-copy status-copy ${
          status === "error" ? "error-copy" : status === "success" ? "success-copy" : ""
        }`}
        aria-live={status === "error" ? "assertive" : "polite"}
      >
        {message}
      </p>
      <div className="actions">
        <Link href="/play" className="primary-link">
          {uiText.action}
        </Link>
      </div>
    </section>
  );
}

export default function VerifyEmailPage() {
  const { messages } = useLocale();
  const uiText = messages.play.emailVerification;

  return (
    <main className="page-shell">
      <div className="content-card">
        <p className="eyebrow">{uiText.title}</p>
        <h1>{uiText.title}</h1>
        <p className="body-copy page-intro">{uiText.intro}</p>
        <Suspense fallback={<p className="body-copy status-copy">{uiText.verifying}</p>}>
          <VerifyEmailContent />
        </Suspense>
      </div>
    </main>
  );
}
