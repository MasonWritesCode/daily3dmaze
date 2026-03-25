import type { RunStatusResponse, RunSubmissionResponse } from "../../lib/api";

export interface DirectionLabels {
  north: string;
  east: string;
  south: string;
  west: string;
}

export interface RoleLabels {
  user: string;
  moderator: string;
  admin: string;
}

export interface VerificationLabels {
  pending: string;
  verified: string;
  suspicious: string;
  invalid: string;
}

export function getLocalizedDirectionLabel(
  directionName: string | undefined,
  directions: DirectionLabels,
  fallback = ""
): string {
  switch (directionName) {
    case "North":
      return directions.north;
    case "East":
      return directions.east;
    case "South":
      return directions.south;
    case "West":
      return directions.west;
    default:
      return directionName ?? fallback;
  }
}

export function getLocalizedRoleLabel(
  role: string | undefined,
  labels: RoleLabels
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

export function getLocalizedVerificationLabel(
  status: string | undefined,
  labels: VerificationLabels
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
      return status ?? "";
  }
}

export function getLeaderboardRankTone(rank: number): string {
  if (rank === 1) {
    return "gold";
  }

  if (rank === 2) {
    return "silver";
  }

  if (rank === 3) {
    return "bronze";
  }

  return "standard";
}

export function shouldPollRunVerification(
  submissionStatus: "idle" | "submitting" | "submitted" | "error",
  submissionSummary: RunSubmissionResponse | null
): submissionSummary is RunSubmissionResponse {
  return Boolean(
    submissionStatus === "submitted" &&
      submissionSummary &&
      submissionSummary.verificationStatus === "pending"
  );
}

export function mergeRunStatusIntoSubmissionSummary(
  currentSummary: RunSubmissionResponse,
  latestStatus: RunStatusResponse
): RunSubmissionResponse {
  return {
    ...currentSummary,
    acceptedAt: latestStatus.acceptedAt,
    suspicionScore: latestStatus.suspicionScore,
    suspicionReasons: latestStatus.suspicionReasons,
    verificationStatus: latestStatus.verificationStatus,
    verificationNotes: latestStatus.verificationNotes
  };
}
