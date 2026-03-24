import { describe, expect, it } from "vitest";

import type { RunReviewEntry } from "../../../lib/api";
import {
  filterRunReviewEntries,
  getLocalizedReviewStatus,
  getLocalizedRoleLabel,
  getLocalizedSuspicionReason,
  getLocalizedVerificationStatus,
  getReviewTone,
  getSuspicionTone,
  getVerificationTone,
  sortRunReviewEntries
} from "./helpers";

function makeEntry(overrides: Partial<RunReviewEntry> = {}): RunReviewEntry {
  return {
    publicId: "run_1",
    date: "2026-03-23",
    seed: "daily3dmaze:2026-03-23",
    username: "mason",
    moveCount: 100,
    elapsedTimeMs: 30000,
    suspicionScore: 0,
    suspicionReasons: [],
    verificationStatus: "verified",
    verificationNotes: [],
    verificationStartedAt: null,
    verifiedAt: "2026-03-23T10:00:00Z",
    verificationAttempts: 1,
    verificationError: null,
    reviewStatus: "unreviewed",
    reviewNotes: "",
    reviewedAt: null,
    reviewedByUsername: null,
    isStalePending: false,
    acceptedAt: "2026-03-23T10:00:00Z",
    ...overrides
  };
}

describe("admin review helpers", () => {
  it("maps suspicion scores to tones", () => {
    expect(getSuspicionTone(10)).toBe("low");
    expect(getSuspicionTone(25)).toBe("medium");
    expect(getSuspicionTone(80)).toBe("high");
  });

  it("maps verification and review statuses to tones", () => {
    expect(getVerificationTone("pending")).toBe("pending");
    expect(getVerificationTone("suspicious")).toBe("medium");
    expect(getVerificationTone("invalid")).toBe("high");
    expect(getVerificationTone("verified")).toBe("low");

    expect(getReviewTone("unreviewed")).toBe("pending");
    expect(getReviewTone("reviewed_clean")).toBe("low");
    expect(getReviewTone("confirmed_suspicious")).toBe("high");
  });

  it("localizes role, verification, review, and suspicion labels", () => {
    expect(
      getLocalizedRoleLabel("moderator", {
        user: "User",
        moderator: "Moderator",
        admin: "Admin"
      })
    ).toBe("Moderator");

    expect(
      getLocalizedVerificationStatus("pending", {
        pending: "Pending",
        verified: "Verified",
        suspicious: "Suspicious",
        invalid: "Invalid"
      })
    ).toBe("Pending");

    expect(
      getLocalizedReviewStatus("reviewed_clean", {
        unreviewed: "Unreviewed",
        reviewedClean: "Reviewed clean",
        confirmedSuspicious: "Confirmed suspicious"
      })
    ).toBe("Reviewed clean");

    expect(
      getLocalizedSuspicionReason("high_action_density", {
        replayLengthMismatch: "Replay length mismatch",
        timestampDrift: "Timestamp drift",
        highActionDensity: "High action density",
        rapidRepeatedTurns: "Rapid repeated turns",
        blockedMoveAttempts: "Blocked move attempts",
        replayDoesNotReachExit: "Replay does not reach exit",
        actionsAfterExit: "Actions after exit"
      })
    ).toBe("High action density");
  });

  it("filters entries by verification state, review state, stale flag, and search query", () => {
    const entries = [
      makeEntry({
        publicId: "run_verified",
        username: "mason",
        verificationStatus: "verified",
        reviewStatus: "reviewed_clean"
      }),
      makeEntry({
        publicId: "run_pending",
        username: "dani",
        verificationStatus: "pending",
        reviewStatus: "unreviewed",
        isStalePending: true,
        reviewNotes: "needs eyes"
      }),
      makeEntry({
        publicId: "run_suspicious",
        username: "alex",
        verificationStatus: "suspicious",
        reviewStatus: "confirmed_suspicious",
        reviewNotes: "confirmed by moderator"
      })
    ];

    expect(
      filterRunReviewEntries(entries, {
        verificationFilter: "pending",
        reviewStatusFilter: "all",
        showOnlyStalePending: false,
        searchQuery: ""
      }).map((entry) => entry.publicId)
    ).toEqual(["run_pending"]);

    expect(
      filterRunReviewEntries(entries, {
        verificationFilter: "all",
        reviewStatusFilter: "confirmed_suspicious",
        showOnlyStalePending: false,
        searchQuery: ""
      }).map((entry) => entry.publicId)
    ).toEqual(["run_suspicious"]);

    expect(
      filterRunReviewEntries(entries, {
        verificationFilter: "all",
        reviewStatusFilter: "all",
        showOnlyStalePending: true,
        searchQuery: ""
      }).map((entry) => entry.publicId)
    ).toEqual(["run_pending"]);

    expect(
      filterRunReviewEntries(entries, {
        verificationFilter: "all",
        reviewStatusFilter: "all",
        showOnlyStalePending: false,
        searchQuery: "confirmed by moderator"
      }).map((entry) => entry.publicId)
    ).toEqual(["run_suspicious"]);
  });

  it("sorts entries by risk, newest, and oldest pending modes", () => {
    const entries = [
      makeEntry({
        publicId: "verified_high",
        verificationStatus: "verified",
        suspicionScore: 70,
        acceptedAt: "2026-03-23T10:00:00Z"
      }),
      makeEntry({
        publicId: "pending_old",
        verificationStatus: "pending",
        suspicionScore: 0,
        acceptedAt: "2026-03-23T08:00:00Z"
      }),
      makeEntry({
        publicId: "invalid_mid",
        verificationStatus: "invalid",
        suspicionScore: 10,
        acceptedAt: "2026-03-23T09:00:00Z"
      })
    ];

    expect(sortRunReviewEntries(entries, "risk").map((entry) => entry.publicId)).toEqual([
      "pending_old",
      "invalid_mid",
      "verified_high"
    ]);

    expect(sortRunReviewEntries(entries, "newest").map((entry) => entry.publicId)).toEqual([
      "verified_high",
      "invalid_mid",
      "pending_old"
    ]);

    expect(
      sortRunReviewEntries(entries, "oldest-pending").map((entry) => entry.publicId)
    ).toEqual(["pending_old", "invalid_mid", "verified_high"]);
  });
});
