import { afterEach, describe, expect, it } from "vitest";
import {
  askForPlayerName,
  type NamePrompt,
} from "../../src/client/components/NamePrompt";
import { hasChosenPlayerName } from "../../src/client/PlayerName";

async function prompt(): Promise<NamePrompt> {
  const el = document.querySelector("name-prompt") as NamePrompt;
  await el.updateComplete;
  return el;
}

function type(el: NamePrompt, value: string) {
  const input = el.querySelector<HTMLInputElement>("[data-name-prompt-input]")!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("name prompt", () => {
  it("stores the chosen name and lets the join go ahead", async () => {
    localStorage.setItem("username", "AnonAnchor");
    const answer = askForPlayerName();
    const el = await prompt();
    // The generated placeholder is not offered as the player's name.
    expect(
      el.querySelector<HTMLInputElement>("[data-name-prompt-input]")!.value,
    ).toBe("");
    type(el, "Bad$");
    await el.updateComplete;
    el.querySelector("form")!.requestSubmit();
    await el.updateComplete;
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.querySelector("name-prompt")).not.toBeNull();

    type(el, "Kaan 1923");
    await el.updateComplete;
    el.querySelector("form")!.requestSubmit();
    await expect(answer).resolves.toBe(true);
    expect(localStorage.getItem("username")).toBe("Kaan 1923");
    expect(hasChosenPlayerName()).toBe(true);
    expect(document.querySelector("name-prompt")).toBeNull();
  });

  it("cancels the join on Cancel or Escape", async () => {
    const first = askForPlayerName();
    (await prompt())
      .querySelector<HTMLButtonElement>("[data-name-prompt-cancel]")!
      .click();
    await expect(first).resolves.toBe(false);

    const second = askForPlayerName();
    await prompt();
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(second).resolves.toBe(false);
    expect(document.querySelector("name-prompt")).toBeNull();
    expect(hasChosenPlayerName()).toBe(false);
  });
});
