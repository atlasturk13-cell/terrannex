export const SYSTEM_UI_FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/**
 * Resolve the CSS-owned UI font token for canvas and SVG surfaces that cannot
 * inherit `font-family` from normal document flow.
 */
export function uiFontFamily(): string {
  if (
    typeof document === "undefined" ||
    typeof getComputedStyle === "undefined"
  ) {
    return SYSTEM_UI_FONT_STACK;
  }

  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--font-ui")
      .trim() || SYSTEM_UI_FONT_STACK
  );
}
