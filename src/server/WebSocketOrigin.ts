/**
 * Browser WebSocket upgrades carry an Origin header. When an allowlist is
 * configured the upgrade is refused unless that origin is listed, or — for the
 * special `same-origin` entry — matches the request Host. With enforcement on,
 * an upgrade without any Origin header is refused as well. `null` disables the
 * check, which the Vite dev server needs because it proxies from another
 * origin.
 */
export function isAllowedWebSocketOrigin(
  originHeader: string | undefined,
  hostHeader: string | undefined,
  allowlist: readonly string[] | null,
): boolean {
  if (allowlist === null) return true;
  if (originHeader === undefined || originHeader === "") return false;
  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return false;
  }
  for (const entry of allowlist) {
    if (entry === "same-origin") {
      if (
        hostHeader !== undefined &&
        origin.host.toLowerCase() === hostHeader.trim().toLowerCase()
      ) {
        return true;
      }
      continue;
    }
    try {
      if (new URL(entry).origin === origin.origin) return true;
    } catch {
      // A malformed allowlist entry never grants access.
    }
  }
  return false;
}
