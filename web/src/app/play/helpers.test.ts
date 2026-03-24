import { describe, expect, it } from "vitest";

import type { RunStatusResponse, RunSubmissionResponse } from "../../lib/api";
import {
  getLeaderboardRankTone,
  getLocalizedDirectionLabel,
  getLocalizedRoleLabel,
  getLocalizedVerificationLabel,
  mergeRunStatusIntoSubmissionSummary,
  shouldPollRunVerification
} from "./helpers";

describe("play helpers", () => {
  it("localizes direction labels with graceful fallback", () => {
    const labels = {
      north: "Norte",
      east: "Este",
      south: "Sur",
      west: "Oeste"
    };

    expect(getLocalizedDirectionLabel("North", labels)).toBe("Norte");
    expect(getLocalizedDirectionLabel("East", labels)).toBe("Este");
    expect(getLocalizedDirectionLabel("Unknown", labels)).toBe("Unknown");
    expect(getLocalizedDirectionLabel(undefined, labels)).toBe("");
  });

  it("localizes role labels with graceful fallback", () => {
    const labels = {
      user: "Usuario",
      moderator: "Moderador",
      admin: "Administrador"
    };

    expect(getLocalizedRoleLabel("user", labels)).toBe("Usuario");
    expect(getLocalizedRoleLabel("moderator", labels)).toBe("Moderador");
    expect(getLocalizedRoleLabel("admin", labels)).toBe("Administrador");
    expect(getLocalizedRoleLabel("guest", labels)).toBe("guest");
  });

  it("localizes verification labels with graceful fallback", () => {
    const labels = {
      pending: "pendiente",
      verified: "verificada",
      suspicious: "sospechosa",
      invalid: "inválida"
    };

    expect(getLocalizedVerificationLabel("pending", labels)).toBe("pendiente");
    expect(getLocalizedVerificationLabel("verified", labels)).toBe("verificada");
    expect(getLocalizedVerificationLabel("suspicious", labels)).toBe("sospechosa");
    expect(getLocalizedVerificationLabel("invalid", labels)).toBe("inválida");
    expect(getLocalizedVerificationLabel("other", labels)).toBe("other");
  });

  it("maps leaderboard ranks to medal tones", () => {
    expect(getLeaderboardRankTone(1)).toBe("gold");
    expect(getLeaderboardRankTone(2)).toBe("silver");
    expect(getLeaderboardRankTone(3)).toBe("bronze");
    expect(getLeaderboardRankTone(4)).toBe("standard");
  });

  it("only polls while a submitted run is still pending verification", () => {
    const summary: RunSubmissionResponse = {
      status: "accepted",
      publicId: "run_test",
      acceptedAt: "2026-03-23T19:37:00Z",
      date: "2026-03-23",
      seed: "daily3dmaze:2026-03-23",
      moveCount: 42,
      elapsedTimeMs: 12345,
      replayTrace: [{ elapsedTimeMs: 0, action: "move_forward" }],
      suspicionScore: 0,
      suspicionReasons: [],
      verificationStatus: "pending",
      verificationNotes: ["queued_for_async_verification"]
    };

    expect(shouldPollRunVerification("submitted", summary)).toBe(true);
    expect(shouldPollRunVerification("submitting", summary)).toBe(false);
    expect(
      shouldPollRunVerification("submitted", {
        ...summary,
        verificationStatus: "verified"
      })
    ).toBe(false);
    expect(shouldPollRunVerification("submitted", null)).toBe(false);
  });

  it("merges polled verification state into the stored submission summary", () => {
    const currentSummary: RunSubmissionResponse = {
      status: "accepted",
      publicId: "run_test",
      acceptedAt: "2026-03-23T19:37:00Z",
      date: "2026-03-23",
      seed: "daily3dmaze:2026-03-23",
      moveCount: 42,
      elapsedTimeMs: 12345,
      replayTrace: [{ elapsedTimeMs: 0, action: "move_forward" }],
      suspicionScore: 0,
      suspicionReasons: [],
      verificationStatus: "pending",
      verificationNotes: ["queued_for_async_verification"]
    };
    const latestStatus: RunStatusResponse = {
      publicId: "run_test",
      status: "accepted",
      acceptedAt: "2026-03-23T19:38:15Z",
      suspicionScore: 5,
      suspicionReasons: ["high_action_density"],
      verificationStatus: "suspicious",
      verificationNotes: ["manual_review_recommended"]
    };

    expect(mergeRunStatusIntoSubmissionSummary(currentSummary, latestStatus)).toEqual({
      ...currentSummary,
      acceptedAt: "2026-03-23T19:38:15Z",
      suspicionScore: 5,
      suspicionReasons: ["high_action_density"],
      verificationStatus: "suspicious",
      verificationNotes: ["manual_review_recommended"]
    });
  });
});
