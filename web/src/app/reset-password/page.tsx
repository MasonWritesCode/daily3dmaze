"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { requestPasswordReset, resetPassword } from "../../lib/api";
import { useLocale } from "../../lib/locale";

type FormStatus = "idle" | "submitting" | "success" | "error";

function ResetPasswordContent() {
  const { messages } = useLocale();
  const uiText = messages.play.passwordReset;
  const searchParams = useSearchParams();
  const token = (searchParams.get("token") ?? "").trim();
  const [identifier, setIdentifier] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [requestStatus, setRequestStatus] = useState<FormStatus>("idle");
  const [resetStatus, setResetStatus] = useState<FormStatus>("idle");
  const [requestMessage, setRequestMessage] = useState("");
  const [resetMessage, setResetMessage] = useState("");

  async function handleRequestSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestStatus("submitting");
    setRequestMessage("");

    try {
      const response = await requestPasswordReset(identifier);
      setRequestStatus("success");
      setRequestMessage(response.message || uiText.requestSuccess);
    } catch (error) {
      setRequestStatus("error");
      setRequestMessage(error instanceof Error ? error.message : uiText.requestError);
    }
  }

  async function handleResetSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResetStatus("submitting");
    setResetMessage("");

    try {
      const response = await resetPassword(token, newPassword);
      setResetStatus("success");
      setResetMessage(response.message || uiText.resetSuccess);
      setNewPassword("");
    } catch (error) {
      setResetStatus("error");
      setResetMessage(error instanceof Error ? error.message : uiText.resetError);
    }
  }

  return (
    <>
      {token ? (
        <section className="maze-summary" aria-labelledby="reset-password-form-title">
          <h2 id="reset-password-form-title" className="section-title">
            {uiText.resetHeading}
          </h2>
          <p className="body-copy">{uiText.resetIntro}</p>
          <form className="auth-form" onSubmit={handleResetSubmit}>
            <label className="auth-field">
              <span>{messages.play.auth.password}</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <div className="actions">
              <button
                type="submit"
                className="primary-button"
                disabled={resetStatus === "submitting"}
              >
                {uiText.resetAction}
              </button>
              <Link href="/play" className="secondary-link">
                {messages.play.actions.logIn}
              </Link>
            </div>
            {resetMessage && (
              <p
                className={`body-copy status-copy ${
                  resetStatus === "error" ? "error-copy" : "success-copy"
                }`}
                aria-live={resetStatus === "error" ? "assertive" : "polite"}
              >
                {resetMessage}
              </p>
            )}
          </form>
        </section>
      ) : (
        <section className="maze-summary" aria-labelledby="request-reset-title">
          <h2 id="request-reset-title" className="section-title">
            {uiText.requestHeading}
          </h2>
          <p className="body-copy">{uiText.requestIntro}</p>
          <p className="assistive-copy">{uiText.tokenMissing}</p>
          <form className="auth-form" onSubmit={handleRequestSubmit}>
            <label className="auth-field">
              <span>{uiText.requestField}</span>
              <input
                type="text"
                autoComplete="username email"
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </label>
            <div className="actions">
              <button
                type="submit"
                className="primary-button"
                disabled={requestStatus === "submitting"}
              >
                {uiText.requestAction}
              </button>
              <Link href="/play" className="secondary-link">
                {messages.play.actions.logIn}
              </Link>
            </div>
            {requestMessage && (
              <p
                className={`body-copy status-copy ${
                  requestStatus === "error" ? "error-copy" : "success-copy"
                }`}
                aria-live={requestStatus === "error" ? "assertive" : "polite"}
              >
                {requestMessage}
              </p>
            )}
          </form>
        </section>
      )}
    </>
  );
}

export default function ResetPasswordPage() {
  const { messages } = useLocale();
  const uiText = messages.play.passwordReset;

  return (
    <main className="page-shell">
      <div className="content-card">
        <p className="eyebrow">{uiText.title}</p>
        <h1>{uiText.title}</h1>
        <p className="body-copy page-intro">{uiText.intro}</p>
        <Suspense fallback={<p className="body-copy status-copy">{uiText.requestIntro}</p>}>
          <ResetPasswordContent />
        </Suspense>
      </div>
    </main>
  );
}
