/**
 * Google AdSense for a hosted deployment. Everything here is inert until the
 * operator sets ADSENSE_CLIENT (the publisher id AdSense shows, for example
 * ca-pub-1234567890123456): without it the app shell, the security headers,
 * /ads.txt and the privacy notice carry no advertising at all, and local play
 * never loads an ad script.
 */

/** Google's TAG-ID in every AdSense ads.txt line. */
export const GOOGLE_ADS_TXT_CERTIFICATION_ID = "f08c47fec0942fa0";

const CLIENT_PATTERN = /^ca-pub-\d{16}$/;
const SLOT_PATTERN = /^\d{6,20}$/;

export type AdSenseSettings = {
  /** Publisher id, ca-pub-XXXXXXXXXXXXXXXX. */
  client: string;
  /** Display ad unit shown on the main menu, when the operator created one. */
  menuSlot: string | null;
};

function trimmed(value: string | undefined): string | null {
  const v = value?.trim();
  return v === undefined || v === "" ? null : v;
}

/**
 * Reads ADSENSE_CLIENT / ADSENSE_MENU_SLOT. Returns null when AdSense is off;
 * throws on a malformed value so a typo fails at boot rather than silently
 * serving a broken ad tag.
 */
export function adSenseSettings(
  env: NodeJS.ProcessEnv = process.env,
): AdSenseSettings | null {
  const client = trimmed(env.ADSENSE_CLIENT);
  const menuSlot = trimmed(env.ADSENSE_MENU_SLOT);
  if (client === null) {
    if (menuSlot !== null) {
      throw new Error("ADSENSE_MENU_SLOT requires ADSENSE_CLIENT");
    }
    return null;
  }
  if (!CLIENT_PATTERN.test(client)) {
    throw new Error(
      `Invalid ADSENSE_CLIENT: ${client} (expected ca-pub- followed by 16 digits)`,
    );
  }
  if (menuSlot !== null && !SLOT_PATTERN.test(menuSlot)) {
    throw new Error(
      `Invalid ADSENSE_MENU_SLOT: ${menuSlot} (expected the numeric ad unit id)`,
    );
  }
  return { client, menuSlot };
}

/** The single ads.txt line that authorises Google to sell this site's inventory. */
export function adsTxt(client: string): string {
  const publisher = client.replace(/^ca-/, "");
  return `google.com, ${publisher}, DIRECT, ${GOOGLE_ADS_TXT_CERTIFICATION_ID}\n`;
}

/** The AdSense loader, with the publisher id Google uses to verify the site. */
export function adSenseScriptSrc(client: string): string {
  return `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
}

/**
 * Origins AdSense and Google's consent message (the certified CMP served from
 * fundingchoicesmessages.google.com) need, per CSP directive. Ad creatives
 * load images from arbitrary advertiser hosts, so img-src opens to https:.
 */
export const ADSENSE_CSP_SOURCES = {
  "script-src": [
    "https://pagead2.googlesyndication.com",
    "https://*.googlesyndication.com",
    "https://*.adtrafficquality.google",
    "https://fundingchoicesmessages.google.com",
    "https://*.google.com",
    "https://*.gstatic.com",
    "https://*.doubleclick.net",
    "https://*.googletagservices.com",
  ],
  "frame-src": [
    "https://googleads.g.doubleclick.net",
    "https://tpc.googlesyndication.com",
    "https://*.googlesyndication.com",
    "https://*.adtrafficquality.google",
    "https://*.doubleclick.net",
    "https://*.google.com",
  ],
  "connect-src": [
    "https://pagead2.googlesyndication.com",
    "https://*.googlesyndication.com",
    "https://*.adtrafficquality.google",
    "https://fundingchoicesmessages.google.com",
    "https://*.google.com",
    "https://*.doubleclick.net",
  ],
  "img-src": ["https:"],
  "font-src": ["https://fonts.gstatic.com"],
} as const;
