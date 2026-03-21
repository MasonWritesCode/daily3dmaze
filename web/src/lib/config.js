export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080";

export const dailyMazeEndpoint = `${apiBaseUrl}/api/daily-maze`;
export const runsEndpoint = `${apiBaseUrl}/api/runs`;
export const leaderboardEndpoint = `${apiBaseUrl}/api/leaderboard`;
export const registerEndpoint = `${apiBaseUrl}/api/auth/register`;
export const loginEndpoint = `${apiBaseUrl}/api/auth/login`;
export const logoutEndpoint = `${apiBaseUrl}/api/auth/logout`;
export const meEndpoint = `${apiBaseUrl}/api/me`;
