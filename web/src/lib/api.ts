import {
  apiBaseUrl,
  dailyMazeEndpoint,
  leaderboardEndpoint,
  loginEndpoint,
  logoutEndpoint,
  meEndpoint,
  registerEndpoint,
  runsEndpoint
} from "./config";
import type { DailyMaze } from "./game/maze";

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
}

export interface RunSubmissionResponse extends RunSubmissionPayload {
  status: string;
  acceptedAt: string;
}

export interface AuthUser {
  id: number;
  username: string;
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

async function readTextError(response: Response, fallback: string): Promise<Error> {
  const message = (await response.text()).trim();
  return new Error(message || fallback);
}

export async function fetchDailyMaze(): Promise<DailyMaze> {
  const response = await fetch(dailyMazeEndpoint);

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
