import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { assertLocalRuntimeBoundary } from "../../src/server/LocalRuntimeBoundary";

const script = path.join(process.cwd(), "scripts/set-domain.sh");
let tempDir: string | null = null;

function run(args: string[]) {
  return spawnSync("sh", [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    out[line.slice(0, eq)] = line.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return out;
}

/** The compose file's fixed environment plus what the script wrote. */
function composeEnv(written: Record<string, string>) {
  return {
    LOCAL_ONLY: "true",
    GAME_ENV: "dev",
    DOMAIN: "localhost",
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TRUST_PROXY_HOPS: "2",
    ENABLE_HSTS: "true",
    ...written,
  };
}

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("scripts/set-domain.sh", () => {
  it("writes a complete hosted .env that the runtime boundary accepts", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "set-domain-"));
    const envFile = path.join(tempDir, ".env");
    fs.writeFileSync(envFile, "SUBDOMAIN=prod\nBIND_HOST=127.0.0.1\n");

    const result = run([
      "https://Play.Example.com/",
      "--source-url",
      "https://github.com/example/territory-lab",
      "--operator-name",
      "Example Studio",
      "--operator-contact",
      "ops@example.com",
      "--workers",
      "3",
      "--env-file",
      envFile,
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Wrote");
    expect(result.stdout).toContain("A record");
    expect(result.stdout).toContain("docker compose up -d --build");

    const written = parseEnv(fs.readFileSync(envFile, "utf8"));
    expect(written.SITE_ADDRESS).toBe("play.example.com");
    expect(written.PUBLIC_ORIGIN).toBe("https://play.example.com");
    expect(written.SOURCE_URL).toBe("https://github.com/example/territory-lab");
    expect(written.OPERATOR_NAME).toBe("Example Studio");
    expect(written.OPERATOR_CONTACT).toBe("ops@example.com");
    expect(written.WS_ALLOWED_ORIGINS).toBe("same-origin");
    expect(written.NUM_WORKERS).toBe("3");
    expect(written.MULTIPLAYER).toBe("true");
    expect(written.PUBLIC_LOBBY_INTERVAL_SECONDS).toBe("30");
    expect(written.GIT_COMMIT).toMatch(/^[0-9a-f]{40}$|^unknown$/);
    // Operator-added keys survive; the previous file is backed up.
    expect(written.SUBDOMAIN).toBe("prod");
    expect(written.BIND_HOST).toBe("127.0.0.1");
    expect(fs.existsSync(`${envFile}.bak`)).toBe(true);
    expect(() => assertLocalRuntimeBoundary(composeEnv(written))).not.toThrow();

    // A later domain change keeps the operator values.
    const again = run([
      "staging.example.com",
      "--env-file",
      envFile,
      "--multiplayer",
      "false",
    ]);
    expect(again.status, again.stderr).toBe(0);
    const rewritten = parseEnv(fs.readFileSync(envFile, "utf8"));
    expect(rewritten.SITE_ADDRESS).toBe("staging.example.com");
    expect(rewritten.PUBLIC_ORIGIN).toBe("https://staging.example.com");
    expect(rewritten.OPERATOR_NAME).toBe("Example Studio");
    expect(rewritten.NUM_WORKERS).toBe("3");
    expect(rewritten.MULTIPLAYER).toBe("false");
    expect(rewritten.SUBDOMAIN).toBe("prod");
  });

  it("refuses bad hostnames and incomplete operator values without writing", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "set-domain-"));
    const envFile = path.join(tempDir, ".env");
    for (const bad of [
      "play",
      "play.example.com/game",
      "play_example.com",
      "x-.example.com",
    ]) {
      const result = run([
        bad,
        "--env-file",
        envFile,
        "--source-url",
        "https://x.example/y",
        "--operator-name",
        "A",
        "--operator-contact",
        "a@b.c",
      ]);
      expect(result.status, bad).toBe(1);
      expect(result.stderr).toContain("invalid domain");
    }
    const incomplete = run(["play.example.com", "--env-file", envFile]);
    expect(incomplete.status).toBe(2);
    expect(incomplete.stderr).toContain("--source-url");
    expect(incomplete.stderr).toContain("--operator-name");
    expect(incomplete.stderr).toContain("--operator-contact");
    expect(fs.existsSync(envFile)).toBe(false);

    const badWorkers = run([
      "play.example.com",
      "--env-file",
      envFile,
      "--source-url",
      "https://x.example/y",
      "--operator-name",
      "A",
      "--operator-contact",
      "a@b.c",
      "--workers",
      "99",
    ]);
    expect(badWorkers.status).toBe(1);
    expect(badWorkers.stderr).toContain("--workers");
  });

  it("prints the variable block for --dry-run and the usage for --help", () => {
    const dry = run([
      "play.example.com",
      "--dry-run",
      "--env-file",
      "/nonexistent/.env",
      "--source-url",
      "https://x.example/y",
      "--operator-name",
      "A B",
      "--operator-contact",
      "a@b.c",
    ]);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("PUBLIC_ORIGIN=https://play.example.com");
    expect(dry.stdout).toContain('OPERATOR_NAME="A B"');
    expect(fs.existsSync("/nonexistent/.env")).toBe(false);
    const help = execFileSync("sh", [script, "--help"], { encoding: "utf8" });
    expect(help).toContain("--source-url");
    expect(help).toContain("--check");
  });
});
