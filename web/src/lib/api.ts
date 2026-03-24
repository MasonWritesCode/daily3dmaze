import {
  adminRunReviewsEndpoint,
  apiBaseUrl,
  dailyMazeEndpoint,
  forgotPasswordEndpoint,
  leaderboardEndpoint,
  loginEndpoint,
  logoutEndpoint,
  meEndpoint,
  registerEndpoint,
  resetPasswordEndpoint,
  runsEndpoint
} from "./config";
import type { DailyMaze, ReplayTraceEvent } from "./game/maze";
export type { ReplayTraceEvent } from "./game/maze";

export interface LeaderboardEntry {
  rank: number;
  username: string;
  role?: string;
  date: string;
  seed: string;
  moveCount: number;
  elapsedTimeMs: number;
  acceptedAt: string;
}

export interface LeaderboardResponse {
  date: string;
  scope?: string;
  entries: LeaderboardEntry[];
}

export interface RunSubmissionPayload {
  date: string;
  seed: string;
  moveCount: number;
  elapsedTimeMs: number;
  replayTrace: ReplayTraceEvent[];
}

export interface RunSubmissionResponse extends RunSubmissionPayload {
  status: string;
  publicId: string;
  acceptedAt: string;
  suspicionScore: number;
  suspicionReasons: string[];
  verificationStatus: string;
  verificationNotes: string[];
}

export interface RunStatusResponse {
  publicId: string;
  status: string;
  acceptedAt: string;
  suspicionScore: number;
  suspicionReasons: string[];
  verificationStatus: string;
  verificationNotes: string[];
}

export interface AuthUser {
  id: number;
  username: string;
  role: string;
}

export interface ForgotPasswordResponse {
  message: string;
}

export interface ResetPasswordResponse {
  message: string;
}

export const ROLE_USER = "user";
export const ROLE_MODERATOR = "moderator";
export const ROLE_ADMIN = "admin";

export function roleAllows(
  role: string | null | undefined,
  ...allowedRoles: string[]
): boolean {
  if (!role) {
    return false;
  }

  if (role === ROLE_ADMIN) {
    return true;
  }

  return allowedRoles.includes(role);
}

export interface AuthResponse {
  user: AuthUser;
}

export interface ProfileRun {
  date: string;
  seed: string;
  moveCount: number;
  elapsedTimeMs: number;
  acceptedAt: string;
}

export interface PlayerProfile {
  user: AuthUser & {
    createdAt: string;
  };
  stats: {
    totalRuns: number;
    daysPlayed: number;
    bestElapsedTimeMs: number | null;
    averageElapsedTimeMs: number | null;
    lastPlayedAt: string | null;
    currentStreakDays: number;
    bestStreakDays: number;
  };
  recentRuns: ProfileRun[];
}

export interface HistoryBestRun {
  username: string;
  role?: string;
  moveCount: number;
  elapsedTimeMs: number;
  acceptedAt: string;
}

export interface HistoryEntry {
  date: string;
  title: string;
  seed: string;
  size: {
    width: number;
    height: number;
  };
  submissionCount: number;
  bestRun: HistoryBestRun | null;
}

export interface HistoryResponse {
  entries: HistoryEntry[];
}

export interface HistoryDayResponse {
  challenge: DailyMaze;
  leaderboard: LeaderboardResponse;
}

export interface RunReviewEntry {
  publicId: string;
  date: string;
  seed: string;
  username: string;
  moveCount: number;
  elapsedTimeMs: number;
  suspicionScore: number;
  suspicionReasons: string[];
  verificationStatus: string;
  verificationNotes: string[];
  verificationStartedAt: string | null;
  verifiedAt: string | null;
  verificationAttempts: number;
  verificationError: string | null;
  reviewStatus: string;
  reviewNotes: string;
  reviewedAt: string | null;
  reviewedByUsername: string | null;
  isStalePending: boolean;
  acceptedAt: string;
}

export interface RunReviewSummary {
  pendingCount: number;
  verifiedCount: number;
  suspiciousCount: number;
  invalidCount: number;
  stalePendingCount: number;
}

export interface RunReviewsResponse {
  summary: RunReviewSummary;
  entries: RunReviewEntry[];
}

export interface RecomputeRunReviewsResponse {
  updatedCount: number;
  skippedCount: number;
}

export interface RequeueRunReviewResponse {
  runPublicId: string;
  verificationStatus: string;
  verificationAttempts: number;
}

export interface UpdateRunReviewPayload {
  reviewStatus: string;
  reviewNotes: string;
}

export interface UpdateRunReviewResponse {
  runPublicId: string;
  reviewStatus: string;
  reviewNotes: string;
  reviewedAt: string | null;
  reviewedByUsername: string | null;
}

export interface RunReviewDetailResponse {
  entry: RunReviewEntry;
  replayTrace: ReplayTraceEvent[];
  simulation?: {
    finalPosition: {
      x: number;
      y: number;
    };
    finalDirectionIndex: number;
    reachedExit: boolean;
    firstExitStep: number;
    blockedMoveCount: number;
    actionsAfterExit: number;
  };
}

export interface AdminUserEntry {
  username: string;
  role: string;
  isBanned: boolean;
  bannedAt: string | null;
  createdAt: string;
}

export interface AdminUsersResponse {
  entries: AdminUserEntry[];
}

export interface UpdateAdminUserRoleResponse {
  username: string;
  role: string;
}

export interface UpdateAdminUserBanResponse {
  username: string;
  isBanned: boolean;
  bannedAt: string | null;
}

async function readTextError(response: Response, fallback: string): Promise<Error> {
  const message = (await response.text()).trim();
  return new Error(message || fallback);
}

export async function fetchDailyMaze(date?: string): Promise<DailyMaze> {
  const endpoint = date
    ? `${dailyMazeEndpoint}?date=${encodeURIComponent(date)}`
    : dailyMazeEndpoint;
  const response = await fetch(endpoint);

  if (!response.ok) {
    throw await readTextError(
      response,
      `Daily maze request failed with status ${response.status}`
    );
  }

  return (await response.json()) as DailyMaze;
}

export async function fetchLeaderboard(
  date: string,
  scope: "all" | "first" = "all"
): Promise<LeaderboardResponse> {
  const response = await fetch(
    `${leaderboardEndpoint}?date=${encodeURIComponent(date)}&scope=${encodeURIComponent(scope)}`
  );

  if (!response.ok) {
    throw await readTextError(
      response,
      `Leaderboard request failed with status ${response.status}`
    );
  }

  return (await response.json()) as LeaderboardResponse;
}

export async function submitRun(
  payload: RunSubmissionPayload
): Promise<RunSubmissionResponse> {
  const response = await fetch(runsEndpoint, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw await readTextError(
      response,
      `Run submission failed with status ${response.status}`
    );
  }

  return (await response.json()) as RunSubmissionResponse;
}

export async function fetchRunStatus(publicId: string): Promise<RunStatusResponse> {
  const response = await fetch(`${runsEndpoint}/${encodeURIComponent(publicId)}`, {
    credentials: "include"
  });

  if (!response.ok) {
    throw await readTextError(
      response,
      `Run status request failed with status ${response.status}`
    );
  }

  return (await response.json()) as RunStatusResponse;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const response = await fetch(meEndpoint, {
    credentials: "include"
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw await readTextError(
      response,
      `Current user request failed with status ${response.status}`
    );
  }

  const payload = (await response.json()) as AuthResponse;
  return payload.user;
}

export async function authenticate(
  mode: "login" | "register",
  credentials: { username: string; email?: string; password: string }
): Promise<AuthUser> {
  const response = await fetch(mode === "register" ? registerEndpoint : loginEndpoint, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(credentials)
  });

  if (!response.ok) {
    throw await readTextError(response, "Authentication failed");
  }

  const payload = (await response.json()) as AuthResponse;
  return payload.user;
}

export async function logout(): Promise<void> {
  const response = await fetch(logoutEndpoint, {
    method: "POST",
    credentials: "include"
  });

  if (!response.ok) {
    throw await readTextError(response, "Logout failed");
  }
}

export async function requestPasswordReset(
  usernameOrEmail: string
): Promise<ForgotPasswordResponse> {
  const response = await fetch(forgotPasswordEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ usernameOrEmail })
  });

  if (!response.ok) {
    throw await readTextError(response, "Password reset request failed");
  }

  return (await response.json()) as ForgotPasswordResponse;
}

export async function resetPassword(
  token: string,
  newPassword: string
): Promise<ResetPasswordResponse> {
  const response = await fetch(resetPasswordEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token, newPassword })
  });

  if (!response.ok) {
    throw await readTextError(response, "Password reset failed");
  }

  return (await response.json()) as ResetPasswordResponse;
}

export async function fetchPlayerProfile(username: string): Promise<PlayerProfile> {
  const response = await fetch(
    `${apiBaseUrl}/api/profile?username=${encodeURIComponent(username)}`
  );

  if (!response.ok) {
    throw await readTextError(
      response,
      `Profile request failed with status ${response.status}`
    );
  }

  return (await response.json()) as PlayerProfile;
}

export async function fetchHistory(limit = 14): Promise<HistoryResponse> {
  const response = await fetch(
    `${apiBaseUrl}/api/history?limit=${encodeURIComponent(String(limit))}`
  );

  if (!response.ok) {
    throw await readTextError(
      response,
      `History request failed with status ${response.status}`
    );
  }

  return (await response.json()) as HistoryResponse;
}

export async function fetchHistoryDay(date: string): Promise<HistoryDayResponse> {
  const response = await fetch(
    `${apiBaseUrl}/api/history/day?date=${encodeURIComponent(date)}`
  );

  if (!response.ok) {
    throw await readTextError(
      response,
      `History day request failed with status ${response.status}`
    );
  }

  return (await response.json()) as HistoryDayResponse;
}

export async function fetchRunReviews(): Promise<RunReviewsResponse> {
  const response = await fetch(adminRunReviewsEndpoint, {
    credentials: "include"
  });

  if (!response.ok) {
    throw await readTextError(
      response,
      `Run reviews request failed with status ${response.status}`
    );
  }

  return (await response.json()) as RunReviewsResponse;
}

export async function fetchRunReviewDetail(
  runPublicID: string
): Promise<RunReviewDetailResponse> {
  const response = await fetch(`${adminRunReviewsEndpoint}/${encodeURIComponent(runPublicID)}`, {
    credentials: "include"
  });

  if (!response.ok) {
    throw await readTextError(
      response,
      `Run review detail request failed with status ${response.status}`
    );
  }

  return (await response.json()) as RunReviewDetailResponse;
}

export async function recomputeRunReviews(): Promise<RecomputeRunReviewsResponse> {
  const response = await fetch(`${adminRunReviewsEndpoint}/recompute`, {
    method: "POST",
    credentials: "include"
  });

  if (!response.ok) {
    throw await readTextError(
      response,
      `Run review recompute failed with status ${response.status}`
    );
  }

  return (await response.json()) as RecomputeRunReviewsResponse;
}

export async function requeueRunReview(
  runPublicID: string
): Promise<RequeueRunReviewResponse> {
  const response = await fetch(
    `${adminRunReviewsEndpoint}/${encodeURIComponent(runPublicID)}/requeue`,
    {
      method: "POST",
      credentials: "include"
    }
  );

  if (!response.ok) {
    throw await readTextError(
      response,
      `Run review requeue failed with status ${response.status}`
    );
  }

  return (await response.json()) as RequeueRunReviewResponse;
}

export async function updateRunReview(
  runPublicID: string,
  payload: UpdateRunReviewPayload
): Promise<UpdateRunReviewResponse> {
  const response = await fetch(
    `${adminRunReviewsEndpoint}/${encodeURIComponent(runPublicID)}/review`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    throw await readTextError(
      response,
      `Run review update failed with status ${response.status}`
    );
  }

  return (await response.json()) as UpdateRunReviewResponse;
}

export async function fetchAdminUsers(): Promise<AdminUsersResponse> {
  const response = await fetch(`${apiBaseUrl}/api/admin/users`, {
    credentials: "include"
  });

  if (!response.ok) {
    throw await readTextError(
      response,
      `Admin users request failed with status ${response.status}`
    );
  }

  return (await response.json()) as AdminUsersResponse;
}

export async function updateAdminUserRole(
  username: string,
  role: string
): Promise<UpdateAdminUserRoleResponse> {
  const response = await fetch(
    `${apiBaseUrl}/api/admin/users/${encodeURIComponent(username)}/role`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ role })
    }
  );

  if (!response.ok) {
    throw await readTextError(
      response,
      `Admin user role update failed with status ${response.status}`
    );
  }

  return (await response.json()) as UpdateAdminUserRoleResponse;
}

export async function updateAdminUserBan(
  username: string,
  banned: boolean
): Promise<UpdateAdminUserBanResponse> {
  const response = await fetch(
    `${apiBaseUrl}/api/admin/users/${encodeURIComponent(username)}/ban`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ banned })
    }
  );

  if (!response.ok) {
    throw await readTextError(
      response,
      `Admin user ban update failed with status ${response.status}`
    );
  }

  return (await response.json()) as UpdateAdminUserBanResponse;
}
