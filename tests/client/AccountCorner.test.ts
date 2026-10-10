import { afterEach, describe, expect, it, vi } from "vitest";
import * as accounts from "../../src/client/accounts/AccountClient";
import {
  ACCOUNT_SESSION_KEY,
  AccountClient,
} from "../../src/client/accounts/AccountClient";
import {
  AccountCorner,
  initials,
} from "../../src/client/components/AccountCorner";
import type { AccountDialog } from "../../src/client/components/AccountDialog";

const PROFILE = {
  id: "acc-1",
  displayName: "Ada Lovelace",
  email: "ada@example.com",
  xp: 120,
  level: 1,
  matches: 2,
  wins: 1,
  nextLevelXp: 140,
  levelXp: 20,
  bonus: { level: 1, troopsPerMille: 5, goldPerMille: 10, spawnRings: 0 },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function install(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(String(input), init),
  );
  const client = new AccountClient(fetchMock as unknown as typeof fetch);
  vi.spyOn(accounts, "accountClient", "get").mockReturnValue(client);
  return { client, fetchMock };
}

async function settle(el: HTMLElement & { updateComplete: Promise<unknown> }) {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await el.updateComplete;
  }
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("account corner", () => {
  it("renders nothing when the server has no accounts", async () => {
    install(() => json({ error: "accounts_disabled" }, 503));
    const corner = new AccountCorner();
    document.body.append(corner);
    await settle(corner);
    expect(corner.querySelector("[data-account-corner]")).toBeNull();
  });

  it("offers Sign in to a guest and opens the dialog", async () => {
    install((url) =>
      url.endsWith("/api/account/config")
        ? json({ enabled: true, googleClientId: null })
        : json({ error: "invalid_credentials" }, 401),
    );
    const corner = new AccountCorner();
    document.body.append(corner);
    await settle(corner);
    const button = corner.querySelector<HTMLButtonElement>(
      "[data-account-corner]",
    );
    expect(button?.textContent).toContain("account.sign_in");
    expect(button?.textContent).toContain("account.guest");
    button?.click();
    const dialog = corner.querySelector("account-dialog") as AccountDialog;
    await settle(dialog);
    expect(dialog.querySelector("[data-account-dialog]")).not.toBeNull();
    expect(dialog.querySelector("[data-google-slot]")).toBeNull();
    expect(dialog.querySelector("[data-account-form]")).not.toBeNull();
  });

  it("creates an account, asks for a country, shows the profile, and signs out", async () => {
    const { fetchMock } = install((url, init) => {
      if (url.endsWith("/api/account/config")) {
        return json({ enabled: true, googleClientId: null });
      }
      if (url.endsWith("/api/account/register")) {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          email: "ada@example.com",
          password: "long-enough-pass",
          displayName: "Ada Lovelace",
        });
        return json({ token: "session-token", profile: PROFILE });
      }
      if (url.endsWith("/api/account/profile")) {
        expect(init?.method).toBe("PATCH");
        expect(JSON.parse(String(init?.body))).toEqual({ country: "tr" });
        return json({ ...PROFILE, country: "tr" });
      }
      return json({ error: "unknown" }, 500);
    });
    const corner = new AccountCorner();
    document.body.append(corner);
    await settle(corner);
    corner.querySelector<HTMLButtonElement>("[data-account-corner]")?.click();
    const dialog = corner.querySelector("account-dialog") as AccountDialog;
    await settle(dialog);
    dialog.querySelector<HTMLButtonElement>("[data-account-switch]")?.click();
    await settle(dialog);
    const form = dialog.querySelector<HTMLFormElement>("[data-account-form]")!;
    (form.elements.namedItem("displayName") as HTMLInputElement).value =
      "Ada Lovelace";
    (form.elements.namedItem("email") as HTMLInputElement).value =
      "ada@example.com";
    (form.elements.namedItem("password") as HTMLInputElement).value =
      "long-enough-pass";
    form.requestSubmit();
    await settle(dialog);

    expect(localStorage.getItem(ACCOUNT_SESSION_KEY)).toBe("session-token");
    // No country yet: the country step comes first and can't be dismissed.
    expect(dialog.querySelector("[data-country-step]")).not.toBeNull();
    expect(dialog.querySelector('[aria-label="account.close"]')).toBeNull();
    dialog.close();
    await settle(dialog);
    expect(dialog.querySelector("[data-country-step]")).not.toBeNull();
    const save = dialog.querySelector<HTMLButtonElement>(
      "[data-country-save]",
    )!;
    expect(save.disabled).toBe(true);
    const picker = dialog.querySelector("country-picker") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await settle(picker);
    picker.querySelector<HTMLButtonElement>('[data-country="tr"]')!.click();
    await settle(dialog);
    expect(save.disabled).toBe(false);
    save.click();
    await settle(dialog);
    expect(dialog.querySelector("[data-country-step]")).toBeNull();
    expect(
      dialog.querySelector("[data-profile-country]")?.textContent,
    ).toContain("Türkiye");
    expect(dialog.querySelector("[data-account-level]")?.textContent).toContain(
      "account.level",
    );
    expect(dialog.querySelector("[data-account-xp]")?.textContent).toContain(
      "20 / 140",
    );
    expect(dialog.querySelector("[data-account-bonus]")).not.toBeNull();
    await settle(corner);
    expect(
      corner.querySelector("[data-account-corner]")?.textContent,
    ).toContain("Ada Lovelace");
    expect(
      corner.querySelector("[data-account-flag]")?.getAttribute("src"),
    ).toContain("flags/tr");
    // A player without a name of their own now plays under the account name.
    expect(localStorage.getItem("username")).toBe("Ada Lovelace");

    dialog.querySelector<HTMLButtonElement>("[data-account-sign-out]")?.click();
    await settle(dialog);
    expect(localStorage.getItem(ACCOUNT_SESSION_KEY)).toBeNull();
    expect(dialog.querySelector("[data-account-form]")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("shows a translated error for a rejected sign-in", async () => {
    install((url) =>
      url.endsWith("/api/account/config")
        ? json({ enabled: true, googleClientId: null })
        : json({ error: "invalid_credentials" }, 401),
    );
    const corner = new AccountCorner();
    document.body.append(corner);
    await settle(corner);
    corner.querySelector<HTMLButtonElement>("[data-account-corner]")?.click();
    const dialog = corner.querySelector("account-dialog") as AccountDialog;
    await settle(dialog);
    const form = dialog.querySelector<HTMLFormElement>("[data-account-form]")!;
    (form.elements.namedItem("email") as HTMLInputElement).value =
      "ada@example.com";
    (form.elements.namedItem("password") as HTMLInputElement).value =
      "wrong-password";
    form.requestSubmit();
    await settle(dialog);
    expect(dialog.querySelector("[data-account-error]")?.textContent).toContain(
      "account.error.invalid_credentials",
    );
  });

  it("restores a stored session on load", async () => {
    localStorage.setItem(ACCOUNT_SESSION_KEY, "stored-token");
    install((url, init) => {
      if (url.endsWith("/api/account/config")) {
        return json({ enabled: true, googleClientId: "client-id" });
      }
      if (url.endsWith("/api/account/me")) {
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer stored-token",
        );
        return json(PROFILE);
      }
      return json({}, 404);
    });
    const corner = new AccountCorner();
    document.body.append(corner);
    await settle(corner);
    expect(
      corner.querySelector("[data-account-corner]")?.textContent,
    ).toContain("Ada Lovelace");
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("  ")).toBe("?");
  });
});
