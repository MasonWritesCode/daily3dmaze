import {
  adminRunReviewsEndpoint,
  apiBaseUrl,
  dailyMazeEndpoint,
  leaderboardEndpoint,
  loginEndpoint,
  logoutEndpoint,
  meEndpoint,
  registerEndpoint,
  runsEndpoint
} from "./config";
import type { DailyMaze, ReplayTraceEvent } from "./game/maze";
export type { ReplayTraceEvent } from "./game/maze";

export interface LeaderboardEntry {
  rank: number;
  username: string;
  date: string;
  seed: string;
  moveCount: number;
  elapsedTimeMs: number;
  acceptedAt: string;
}

export interface LeaderboardResponse {
  date: string;
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
  id: number;
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
  runId: number;
  verificationStatus: string;
  verificationAttempts: number;
}

export interface UpdateRunReviewPayload {
  reviewStatus: string;
  reviewNotes: string;
}

export interface UpdateRunReviewResponse {
  runId: number;
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

export async function fetchLeaderboard(date: string): Promise<LeaderboardResponse> {
  const response = await fetch(
    `${leaderboardEndpoint}?date=${encodeURIComponent(date)}`
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
  credentials: { username: string; password: string }
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
  runID: string
): Promise<RunReviewDetailResponse> {
  const response = await fetch(`${adminRunReviewsEndpoint}/${encodeURIComponent(runID)}`, {
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
  runID: string
): Promise<RequeueRunReviewResponse> {
  const response = await fetch(
    `${adminRunReviewsEndpoint}/${encodeURIComponent(runID)}/requeue`,
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
  runID: string,
  payload: UpdateRunReviewPayload
): Promise<UpdateRunReviewResponse> {
  const response = await fetch(
    `${adminRunReviewsEndpoint}/${encodeURIComponent(runID)}/review`,
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
