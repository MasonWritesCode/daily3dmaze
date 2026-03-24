import type { RunReviewEntry } from "../../../lib/api";

export type VerificationFilter =
  | "all"
  | "pending"
  | "verified"
  | "suspicious"
  | "invalid";
export type ReviewStatusFilter =
  | "all"
  | "unreviewed"
  | "reviewed_clean"
  | "confirmed_suspicious";
export type SortMode = "risk" | "newest" | "oldest-pending";

export function getSuspicionTone(score: number): string {
  if (score >= 50) {
    return "high";
  }

  if (score >= 20) {
    return "medium";
  }

  return "low";
}

export function getVerificationTone(status: string): string {
  if (status === "pending") {
    return "pending";
  }

  if (status === "invalid") {
    return "high";
  }

  if (status === "suspicious") {
    return "medium";
  }

  return "low";
}

export function getReviewTone(status: string): string {
  if (status === "confirmed_suspicious") {
    return "high";
  }

  if (status === "reviewed_clean") {
    return "low";
  }

  return "pending";
}

export function getLocalizedRoleLabel(
  role: string | undefined,
  labels: {
    user: string;
    moderator: string;
    admin: string;
  }
): string {
  switch (role) {
    case "user":
      return labels.user;
    case "moderator":
      return labels.moderator;
    case "admin":
      return labels.admin;
    default:
      return role ?? "";
  }
}

export function getLocalizedVerificationStatus(
  status: string,
  labels: {
    pending: string;
    verified: string;
    suspicious: string;
    invalid: string;
  }
): string {
  switch (status) {
    case "pending":
      return labels.pending;
    case "verified":
      return labels.verified;
    case "suspicious":
      return labels.suspicious;
    case "invalid":
      return labels.invalid;
    default:
      return status;
  }
}

export function getLocalizedReviewStatus(
  status: string,
  labels: {
    unreviewed: string;
    reviewedClean: string;
    confirmedSuspicious: string;
  }
): string {
  if (status === "reviewed_clean") {
    return labels.reviewedClean;
  }

  if (status === "confirmed_suspicious") {
    return labels.confirmedSuspicious;
  }

  return labels.unreviewed;
}

export function getLocalizedSuspicionReason(
  reason: string,
  labels: {
    replayLengthMismatch: string;
    timestampDrift: string;
    highActionDensity: string;
    rapidRepeatedTurns: string;
    blockedMoveAttempts: string;
    replayDoesNotReachExit: string;
    actionsAfterExit: string;
  }
): string {
  switch (reason) {
    case "replay_length_mismatch":
      return labels.replayLengthMismatch;
    case "timestamp_drift":
      return labels.timestampDrift;
    case "high_action_density":
      return labels.highActionDensity;
    case "rapid_repeated_turns":
      return labels.rapidRepeatedTurns;
    case "blocked_move_attempts":
      return labels.blockedMoveAttempts;
    case "replay_does_not_reach_exit":
      return labels.replayDoesNotReachExit;
    case "actions_after_exit":
      return labels.actionsAfterExit;
    default:
      return reason;
  }
}

export function filterRunReviewEntries(
  entries: RunReviewEntry[],
  options: {
    verificationFilter: VerificationFilter;
    reviewStatusFilter: ReviewStatusFilter;
    showOnlyStalePending: boolean;
    searchQuery: string;
  }
): RunReviewEntry[] {
  const normalizedQuery = options.searchQuery.trim().toLowerCase();

  return entries.filter((entry) => {
    if (
      options.verificationFilter !== "all" &&
      entry.verificationStatus !== options.verificationFilter
    ) {
      return false;
    }

    if (
      options.reviewStatusFilter !== "all" &&
      entry.reviewStatus !== options.reviewStatusFilter
    ) {
      return false;
    }

    if (options.showOnlyStalePending && !entry.isStalePending) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      entry.username || "anonymous",
      entry.date,
      entry.seed,
      entry.verificationStatus,
      entry.reviewStatus,
      entry.reviewNotes
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

function getVerificationStatusWeight(status: string): number {
  return status === "pending"
    ? 4
    : status === "invalid"
      ? 3
      : status === "suspicious"
        ? 2
        : 1;
}

export function sortRunReviewEntries(
  entries: RunReviewEntry[],
  sortMode: SortMode
): RunReviewEntry[] {
  return [...entries].sort((left, right) => {
    if (sortMode === "newest") {
      return right.acceptedAt.localeCompare(left.acceptedAt);
    }

    if (sortMode === "oldest-pending") {
      if (left.verificationStatus === "pending" && right.verificationStatus !== "pending") {
        return -1;
      }

      if (right.verificationStatus === "pending" && left.verificationStatus !== "pending") {
        return 1;
      }

      return left.acceptedAt.localeCompare(right.acceptedAt);
    }

    const leftStatusWeight = getVerificationStatusWeight(left.verificationStatus);
    const rightStatusWeight = getVerificationStatusWeight(right.verificationStatus);
    if (rightStatusWeight !== leftStatusWeight) {
      return rightStatusWeight - leftStatusWeight;
    }

    if (right.suspicionScore !== left.suspicionScore) {
      return right.suspicionScore - left.suspicionScore;
    }

    return right.acceptedAt.localeCompare(left.acceptedAt);
  });
}
