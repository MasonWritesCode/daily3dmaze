export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080";

export const dailyMazeEndpoint = `${apiBaseUrl}/api/daily-maze`;
