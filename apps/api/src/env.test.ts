import { afterEach, describe, expect, it, vi } from "vitest";

async function loadApiEnv(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  return import("./env.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("API environment", () => {
  it("requires explicit public origins on Vercel", async () => {
    await expect(loadApiEnv({
      VERCEL: "1",
      PUBLIC_API_URL: undefined,
      DASHBOARD_ORIGINS: undefined,
    })).rejects.toThrow(/PUBLIC_API_URL[\s\S]*DASHBOARD_ORIGINS/);
  });

  it("requires at least one dashboard origin on Vercel", async () => {
    await expect(loadApiEnv({
      VERCEL: "1",
      PUBLIC_API_URL: "https://api.deskroute.example",
      DASHBOARD_ORIGINS: " , ",
    })).rejects.toThrow(/DASHBOARD_ORIGINS/);
  });

  it.each([
    "http://deskroute.example",
    "https://localhost:8080",
    "https://user:password@deskroute.example",
    "https://deskroute.example/api",
    "https://deskroute.example?mode=prod",
    "https://deskroute.example#fragment",
  ])("rejects non-production PUBLIC_API_URL on Vercel: %s", async (invalidOrigin) => {
    await expect(loadApiEnv({
      VERCEL: "1",
      PUBLIC_API_URL: invalidOrigin,
      DASHBOARD_ORIGINS: "https://dashboard.deskroute.example",
    })).rejects.toThrow(/PUBLIC_API_URL/);
  });

  it.each([
    "http://dashboard.deskroute.example",
    "https://localhost:5173",
    "https://user:password@dashboard.deskroute.example",
    "https://dashboard.deskroute.example/settings",
    "https://dashboard.deskroute.example?mode=prod",
    "https://dashboard.deskroute.example#fragment",
  ])("rejects any non-production DASHBOARD_ORIGINS entry on Vercel: %s", async (invalidOrigin) => {
    await expect(loadApiEnv({
      VERCEL: "1",
      PUBLIC_API_URL: "https://api.deskroute.example",
      DASHBOARD_ORIGINS: `https://dashboard.deskroute.example,${invalidOrigin}`,
    })).rejects.toThrow(/DASHBOARD_ORIGINS/);
  });

  it("accepts HTTPS root origins on Vercel", async () => {
    const { env } = await loadApiEnv({
      VERCEL: "1",
      PUBLIC_API_URL: "https://api.deskroute.example",
      DASHBOARD_ORIGINS: "https://deskroute.example, https://admin.deskroute.example/",
    });

    expect(env.PUBLIC_API_URL).toBe("https://api.deskroute.example");
    expect(env.DASHBOARD_ORIGINS).toEqual([
      "https://deskroute.example",
      "https://admin.deskroute.example/",
    ]);
  });

  it("preserves localhost defaults outside Vercel", async () => {
    const { env } = await loadApiEnv({
      VERCEL: undefined,
      PUBLIC_API_URL: undefined,
      DASHBOARD_ORIGINS: undefined,
    });

    expect(env.PUBLIC_API_URL).toBeUndefined();
    expect(env.DASHBOARD_ORIGINS).toEqual(["http://localhost:5173"]);
  });
});
