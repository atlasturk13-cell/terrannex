/**
 * /api/account/* on the master: sign-up, sign-in, Google and profile. All
 * answers are JSON; errors use short codes the client translates. Tight
 * per-IP rate limits because every one of these is a credential endpoint.
 */
import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { isAccountCountry } from "./AccountCountry";
import {
  type AccountsService,
  accountsService,
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  PASSWORD_MIN,
} from "./AccountsService";

const EmailSchema = z.string().trim().toLowerCase().email().max(254);
const PasswordSchema = z.string().min(PASSWORD_MIN).max(256);
const DisplayNameSchema = z
  .string()
  .trim()
  .min(DISPLAY_NAME_MIN)
  .max(DISPLAY_NAME_MAX)
  .regex(/^[\p{L}\p{N} _.'-]+$/u);

const RegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: DisplayNameSchema,
});
const LoginSchema = z.object({ email: EmailSchema, password: PasswordSchema });
const GoogleSchema = z.object({ idToken: z.string().min(20).max(4096) });
const ProfileSchema = z
  .object({
    displayName: DisplayNameSchema.optional(),
    country: z
      .string()
      .refine((code) => isAccountCountry(code))
      .nullable()
      .optional(),
  })
  .strict();

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

export function registerAccountRoutes(
  app: Express,
  service: () => AccountsService | null = accountsService,
): void {
  const credentialLimit = rateLimit({
    windowMs: 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "rate_limited" },
  });

  const withService = (
    handler: (
      service: AccountsService,
      req: Request,
      res: Response,
    ) => Promise<void>,
  ) => {
    return async (req: Request, res: Response) => {
      const current = service();
      if (current === null) return fail(res, 503, "accounts_disabled");
      try {
        await handler(current, req, res);
      } catch (error) {
        if (error instanceof Error && error.message === "email_taken") {
          return fail(res, 409, "email_taken");
        }
        console.error("account route failed", error);
        fail(res, 500, "unknown");
      }
    };
  };

  app.get(
    "/api/account/config",
    withService(async (current, _req, res) => {
      res.json({ enabled: true, googleClientId: current.googleClientId });
    }),
  );

  app.post(
    "/api/account/register",
    credentialLimit,
    withService(async (current, req, res) => {
      const parsed = RegisterSchema.safeParse(req.body);
      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path[0];
        return fail(
          res,
          400,
          field === "password"
            ? "weak_password"
            : field === "displayName"
              ? "invalid_name"
              : "invalid_email",
        );
      }
      const { email, password, displayName } = parsed.data;
      res.json(await current.register(email, password, displayName));
    }),
  );

  app.post(
    "/api/account/login",
    credentialLimit,
    withService(async (current, req, res) => {
      const parsed = LoginSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "invalid_credentials");
      const session = await current.login(
        parsed.data.email,
        parsed.data.password,
      );
      if (session === null) return fail(res, 401, "invalid_credentials");
      res.json(session);
    }),
  );

  app.post(
    "/api/account/google",
    credentialLimit,
    withService(async (current, req, res) => {
      if (current.googleClientId === null)
        return fail(res, 404, "google_rejected");
      const parsed = GoogleSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "google_rejected");
      const session = await current.signInWithGoogle(parsed.data.idToken);
      if (session === null) return fail(res, 401, "google_rejected");
      res.json(session);
    }),
  );

  app.get(
    "/api/account/me",
    withService(async (current, req, res) => {
      const token = bearer(req);
      const session =
        token === null ? null : await current.verifySession(token);
      if (session === null) return fail(res, 401, "invalid_credentials");
      const profile = current.profile(session.id);
      if (profile === null) return fail(res, 401, "invalid_credentials");
      res.json(profile);
    }),
  );

  app.patch(
    "/api/account/profile",
    credentialLimit,
    withService(async (current, req, res) => {
      const token = bearer(req);
      const session =
        token === null ? null : await current.verifySession(token);
      if (session === null) return fail(res, 401, "invalid_credentials");
      const parsed = ProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path[0];
        return fail(
          res,
          400,
          field === "country" ? "invalid_country" : "invalid_name",
        );
      }
      const profile = current.updateProfile(session.id, parsed.data);
      if (profile === null) return fail(res, 401, "invalid_credentials");
      res.json(profile);
    }),
  );
}
