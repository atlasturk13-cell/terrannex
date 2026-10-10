// @vitest-environment node
import express from "express";
import http from "http";
import { afterEach, describe, expect, it } from "vitest";
import { registerAccountRoutes } from "../../src/server/accounts/AccountRoutes";
import {
  AccountsService,
  MIN_AWARD_DURATION_MS,
  setAccountsServiceForTests,
} from "../../src/server/accounts/AccountsService";
import { AccountStore } from "../../src/server/accounts/AccountStore";
import { placementsForResult } from "../../src/server/accounts/MatchPlacement";
import { SessionSigner } from "../../src/server/accounts/Session";
import { verifyClientToken } from "../../src/server/jwt";

const SECRET = "test-session-secret-with-plenty-of-length";

function service(googleClientId: string | null = null) {
  return new AccountsService(
    new AccountStore(),
    new SessionSigner(SECRET),
    googleClientId,
    null,
  );
}

async function serve(current: AccountsService | null) {
  const app = express();
  app.use(express.json());
  registerAccountRoutes(app, () => current);
  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const url = `http://127.0.0.1:${port}`;
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(url + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  return {
    url,
    post,
    get: (path: string, headers: Record<string, string> = {}) =>
      fetch(url + path, { headers }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

afterEach(() => setAccountsServiceForTests(undefined));

describe("account routes", () => {
  it("answer 503 for every route while accounts are off", async () => {
    const s = await serve(null);
    try {
      for (const path of ["/api/account/config", "/api/account/me"]) {
        const res = await s.get(path);
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: "accounts_disabled" });
      }
      expect((await s.post("/api/account/login", {})).status).toBe(503);
    } finally {
      await s.close();
    }
  });

  it("register, sign in, read the profile and reject bad input", async () => {
    const current = service();
    const s = await serve(current);
    try {
      const config = await (await s.get("/api/account/config")).json();
      expect(config).toEqual({ enabled: true, googleClientId: null });

      const weak = await s.post("/api/account/register", {
        email: "ada@example.com",
        password: "short",
        displayName: "Ada",
      });
      expect(weak.status).toBe(400);
      expect(await weak.json()).toEqual({ error: "weak_password" });
      const badName = await s.post("/api/account/register", {
        email: "ada@example.com",
        password: "long-enough-pass",
        displayName: "<script>",
      });
      expect(await badName.json()).toEqual({ error: "invalid_name" });

      const registered = await s.post("/api/account/register", {
        email: "Ada@Example.com",
        password: "long-enough-pass",
        displayName: "Ada",
      });
      expect(registered.status).toBe(200);
      const session = (await registered.json()) as {
        token: string;
        profile: {
          level: number;
          email: string;
          bonus: { troopsPerMille: number };
        };
      };
      expect(session.profile.email).toBe("ada@example.com");
      expect(session.profile.level).toBe(0);
      expect(session.profile.bonus.troopsPerMille).toBe(0);

      const dup = await s.post("/api/account/register", {
        email: "ada@example.com",
        password: "another-long-pass",
        displayName: "Ada2",
      });
      expect(dup.status).toBe(409);

      const wrong = await s.post("/api/account/login", {
        email: "ada@example.com",
        password: "not-the-password",
      });
      expect(wrong.status).toBe(401);
      const login = await s.post("/api/account/login", {
        email: "ada@example.com",
        password: "long-enough-pass",
      });
      expect(login.status).toBe(200);

      const me = await s.get("/api/account/me", {
        Authorization: `Bearer ${session.token}`,
      });
      expect(me.status).toBe(200);
      expect(((await me.json()) as { displayName: string }).displayName).toBe(
        "Ada",
      );
      expect((await s.get("/api/account/me")).status).toBe(401);
      expect(
        (await s.get("/api/account/me", { Authorization: "Bearer nope" }))
          .status,
      ).toBe(401);

      const google = await s.post("/api/account/google", {
        idToken: "x".repeat(40),
      });
      expect(google.status).toBe(404);
    } finally {
      await s.close();
    }
  });

  it("lets a signed-in player set their country and name", async () => {
    const current = service();
    const s = await serve(current);
    const patch = (body: unknown, token?: string) =>
      fetch(s.url + "/api/account/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    try {
      const registered = await s.post("/api/account/register", {
        email: "ada@example.com",
        password: "long-enough-pass",
        displayName: "Ada",
      });
      const { token, profile } = (await registered.json()) as {
        token: string;
        profile: { country: string | null };
      };
      expect(profile.country).toBeNull();

      expect((await patch({ country: "tr" })).status).toBe(401);

      const bad = await patch({ country: "Abbasid Caliphate" }, token);
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({ error: "invalid_country" });
      const badName = await patch({ displayName: "<b>" }, token);
      expect(await badName.json()).toEqual({ error: "invalid_name" });
      expect((await patch({ xp: 999 }, token)).status).toBe(400);

      const set = await patch({ country: "tr", displayName: "Atlas" }, token);
      expect(set.status).toBe(200);
      expect(await set.json()).toMatchObject({
        country: "tr",
        displayName: "Atlas",
        xp: 0,
      });

      const session = await current.verifySession(token);
      expect(session).toMatchObject({ country: "tr", displayName: "Atlas" });

      const cleared = await patch({ country: null }, token);
      expect(((await cleared.json()) as { country: null }).country).toBeNull();
    } finally {
      await s.close();
    }
  });

  it("the game server accepts a session token as the player's identity", async () => {
    const current = service();
    setAccountsServiceForTests(current);
    const { token, profile } = await current.register(
      "p@example.com",
      "long-enough-pass",
      "Player",
    );
    const result = await verifyClientToken(token);
    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.persistentId).toBe(profile.id);
      expect(result.claims).toBeNull();
      expect(result.account).toEqual({
        id: profile.id,
        displayName: "Player",
        level: 0,
        country: null,
      });
    }
    const other = new SessionSigner(SECRET + "x");
    const forged = await other.sign({
      accountId: profile.id,
      displayName: "P",
    });
    expect((await verifyClientToken(forged)).type).toBe("error");
  });
});

describe("progression awards", () => {
  it("places the winner first, the eliminated by death order, survivors second", () => {
    const players = [
      { clientID: "A", accountId: "acc-a" },
      { clientID: "B", accountId: null },
      { clientID: "C", accountId: "acc-c" },
      { clientID: "D", accountId: "acc-d" },
    ];
    const stats = {
      A: {},
      B: { deathPosition: 4 },
      C: { deathPosition: 3 },
      D: {},
    };
    expect(placementsForResult(players, ["player", "A"], stats)).toEqual([
      { accountId: "acc-a", placement: 1 },
      { accountId: "acc-c", placement: 3 },
      { accountId: "acc-d", placement: 2 },
    ]);
    expect(
      placementsForResult(players, ["team", "Red", "C", "D"], stats),
    ).toEqual([
      { accountId: "acc-a", placement: 2 },
      { accountId: "acc-c", placement: 1 },
      { accountId: "acc-d", placement: 1 },
    ]);
    expect(
      placementsForResult(players, undefined, stats).map((p) => p.placement),
    ).toEqual([2, 3, 2]);
  });

  it("awards only long enough matches with several humans, once per game", async () => {
    const current = service();
    const a = await current.register("a@example.com", "long-enough-pass", "A");
    const b = await current.register("b@example.com", "long-enough-pass", "B");
    const players = [
      { accountId: a.profile.id, placement: 1 },
      { accountId: b.profile.id, placement: 2 },
    ];
    expect(
      current.awardMatch("g1", MIN_AWARD_DURATION_MS - 1, players, 2).size,
    ).toBe(0);
    expect(
      current.awardMatch("g1", MIN_AWARD_DURATION_MS, players, 1).size,
    ).toBe(0);
    const granted = current.awardMatch("g1", MIN_AWARD_DURATION_MS, players, 2);
    expect([...granted.values()]).toEqual([60, 20]);
    expect(
      current.awardMatch("g1", MIN_AWARD_DURATION_MS, players, 2).size,
    ).toBe(0);
    // Six humans, two of them signed in: the runner-up is on the podium.
    const podium = current.awardMatch("g2", MIN_AWARD_DURATION_MS, players, 6);
    expect(podium.get(b.profile.id)).toBe(35);
    expect(current.profile(a.profile.id)?.xp).toBe(120);
    expect(current.profile(a.profile.id)?.level).toBe(1);
    expect(current.profile(a.profile.id)?.levelXp).toBe(20);
    expect(current.profile(a.profile.id)?.nextLevelXp).toBe(140);
  });
});
