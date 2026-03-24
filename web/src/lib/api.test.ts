import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ROLE_ADMIN,
  ROLE_MODERATOR,
  ROLE_USER,
  authenticate,
  fetchCurrentUser,
  fetchLeaderboard,
  fetchRunStatus,
  roleAllows,
  submitRun
} from "./api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("roleAllows", () => {
  it("grants admins all protected capabilities", () => {
    expect(roleAllows(ROLE_ADMIN, ROLE_MODERATOR)).toBe(true);
    expect(roleAllows(ROLE_ADMIN, ROLE_USER)).toBe(true);
  });

  it("grants explicitly allowed non-admin roles", () => {
    expect(roleAllows(ROLE_MODERATOR, ROLE_MODERATOR)).toBe(true);
    expect(roleAllows(ROLE_USER, ROLE_USER)).toBe(true);
  });

  it("rejects missing or disallowed roles", () => {
    expect(roleAllows(undefined, ROLE_MODERATOR)).toBe(false);
    expect(roleAllows(null, ROLE_MODERATOR)).toBe(false);
    expect(roleAllows(ROLE_USER, ROLE_MODERATOR)).toBe(false);
  });
});

describe("api client helpers", () => {
  it("fetches the leaderboard with the selected scope", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ date: "2026-03-23", scope: "first", entries: [] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const payload = await fetchLeaderboard("2026-03-23", "first");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/leaderboard?date=2026-03-23&scope=first")
    );
    expect(payload.scope).toBe("first");
  });

  it("submits runs with credentials and a JSON body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "accepted",
          publicId: "run_test",
          acceptedAt: "2026-03-23T19:37:00Z",
          suspicionScore: 0,
          suspicionReasons: [],
          verificationStatus: "pending",
          verificationNotes: ["queued_for_async_verification"]
        }),
        {
          status: 202,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    await submitRun({
      date: "2026-03-23",
      seed: "daily3dmaze:2026-03-23",
      moveCount: 42,
      elapsedTimeMs: 12345,
      replayTrace: [{ elapsedTimeMs: 0, action: "move_forward" }]
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/runs"),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const options = fetchMock.mock.calls[0]?.[1];
    expect(typeof options?.body).toBe("string");
    expect(JSON.parse(String(options?.body))).toMatchObject({
      date: "2026-03-23",
      moveCount: 42
    });
  });

  it("returns null for unauthenticated current-user requests", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));

    await expect(fetchCurrentUser()).resolves.toBeNull();
  });

  it("reads backend text errors for failed authentication", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("account is disabled", { status: 403 })
    );

    await expect(
      authenticate("login", { username: "mason", password: "password12345" })
    ).rejects.toThrow("account is disabled");
  });

  it("fetches run status with credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          publicId: "run_test",
          status: "accepted",
          acceptedAt: "2026-03-23T19:37:00Z",
          suspicionScore: 0,
          suspicionReasons: [],
          verificationStatus: "verified",
          verificationNotes: ["simulation_matches_expected_outcome"]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    const payload = await fetchRunStatus("run_test");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/runs/run_test"),
      expect.objectContaining({
        credentials: "include"
      })
    );
    expect(payload.verificationStatus).toBe("verified");
  });
});
