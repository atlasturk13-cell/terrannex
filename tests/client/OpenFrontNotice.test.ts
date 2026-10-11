import { describe, expect, it } from "vitest";
import { GameStartingModal } from "../../src/client/GameStartingModal";

// OpenFront's licence (AGPL §7(b) additional term) requires "© OpenFront and
// Contributors" in a reasonably visible place. Terrannex keeps it on the match
// loading screen, which every match shows, and on the About page.
describe("OpenFront copyright notice", () => {
  it("stays on the match loading screen", async () => {
    const modal = new GameStartingModal();
    document.body.append(modal);
    modal.show();
    await modal.updateComplete;
    expect(modal.textContent).toContain("main.copyright");
    modal.remove();
  });
});
