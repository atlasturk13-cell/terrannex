/**
 * Google Identity Services button. The script is loaded only when the
 * operator configured a Google OAuth client id, and only when the sign-in
 * dialog opens, so the menu never contacts Google by itself.
 */

const GSI_SCRIPT_URL = "https://accounts.google.com/gsi/client";

interface GoogleAccounts {
  id: {
    initialize(config: {
      client_id: string;
      callback: (response: { credential: string }) => void;
      ux_mode?: "popup" | "redirect";
      auto_select?: boolean;
      itp_support?: boolean;
    }): void;
    renderButton(
      parent: HTMLElement,
      options: {
        type?: "standard" | "icon";
        theme?: "outline" | "filled_blue" | "filled_black";
        size?: "large" | "medium" | "small";
        text?: "signin_with" | "signup_with" | "continue_with" | "signin";
        shape?: "rectangular" | "pill" | "circle" | "square";
        width?: number;
        locale?: string;
      },
    ): void;
    disableAutoSelect(): void;
  };
}

declare global {
  interface Window {
    google?: { accounts: GoogleAccounts };
  }
}

let loading: Promise<GoogleAccounts> | null = null;

/** Loads the GIS script once; rejects when it cannot be loaded (CSP, offline). */
export function loadGoogleIdentity(
  doc: Document = document,
): Promise<GoogleAccounts> {
  if (window.google?.accounts) return Promise.resolve(window.google.accounts);
  loading ??= new Promise<GoogleAccounts>((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = GSI_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts) resolve(window.google.accounts);
      else reject(new Error("Google Identity Services did not initialise"));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Google Identity Services failed to load"));
    };
    doc.head.append(script);
  });
  return loading;
}

/**
 * Renders the official button into `parent`; `onCredential` receives the ID
 * token the server verifies. Resolves false when the button is unavailable
 * so the dialog can say so instead of showing an empty box.
 */
export async function renderGoogleButton(
  parent: HTMLElement,
  clientId: string,
  onCredential: (idToken: string) => void,
  locale = "en",
): Promise<boolean> {
  try {
    const accounts = await loadGoogleIdentity();
    accounts.id.initialize({
      client_id: clientId,
      callback: (response) => onCredential(response.credential),
      ux_mode: "popup",
      auto_select: false,
      itp_support: true,
    });
    parent.replaceChildren();
    accounts.id.renderButton(parent, {
      type: "standard",
      theme: "filled_black",
      size: "large",
      text: "continue_with",
      shape: "pill",
      width: Math.min(
        360,
        Math.max(200, Math.floor(parent.clientWidth || 320)),
      ),
      locale,
    });
    return true;
  } catch {
    return false;
  }
}

/** Origins the page policy must allow for the Google button to work. */
export const GOOGLE_SIGN_IN_CSP_SOURCES = {
  "script-src": ["https://accounts.google.com/gsi/client"],
  "frame-src": ["https://accounts.google.com/gsi/"],
  "connect-src": ["https://accounts.google.com/gsi/"],
  "style-src": ["https://accounts.google.com/gsi/style"],
} as const;
