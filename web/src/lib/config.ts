const defaultApiPort = process.env.NEXT_PUBLIC_API_PORT ?? "8080";

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function runtimeSameHostApiBaseUrl(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.protocol}//${window.location.hostname}:${defaultApiPort}`;
}

function resolveApiBaseUrl(): string {
  const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const runtimeApiBaseUrl = runtimeSameHostApiBaseUrl();

  if (!configuredApiBaseUrl) {
    return trimTrailingSlash(runtimeApiBaseUrl ?? `http://localhost:${defaultApiPort}`);
  }

  if (!runtimeApiBaseUrl || process.env.NODE_ENV === "production") {
    return trimTrailingSlash(configuredApiBaseUrl);
  }

  try {
    const configuredUrl = new URL(configuredApiBaseUrl);
    const runtimeUrl = new URL(runtimeApiBaseUrl);

    if (configuredUrl.hostname === runtimeUrl.hostname) {
      return trimTrailingSlash(configuredApiBaseUrl);
    }

    return trimTrailingSlash(runtimeApiBaseUrl);
  } catch {
    return trimTrailingSlash(configuredApiBaseUrl);
  }
}

export const apiBaseUrl = resolveApiBaseUrl();

export const dailyMazeEndpoint = `${apiBaseUrl}/api/daily-maze`;
export const runsEndpoint = `${apiBaseUrl}/api/runs`;
export const leaderboardEndpoint = `${apiBaseUrl}/api/leaderboard`;
export const registerEndpoint = `${apiBaseUrl}/api/auth/register`;
export const loginEndpoint = `${apiBaseUrl}/api/auth/login`;
export const logoutEndpoint = `${apiBaseUrl}/api/auth/logout`;
export const meEndpoint = `${apiBaseUrl}/api/me`;
export const adminRunReviewsEndpoint = `${apiBaseUrl}/api/admin/run-reviews`;
export const githubOAuthEnabled =
  process.env.NEXT_PUBLIC_GITHUB_OAUTH_ENABLED === "true";

export function oauthStartEndpoint(provider: string): string {
  return `${apiBaseUrl}/api/auth/oauth/${provider}/start`;
}
