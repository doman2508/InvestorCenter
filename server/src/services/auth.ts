import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const SESSION_COOKIE = "investor_center_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

type SessionRecord = {
  username: string;
  expiresAt: number;
};

const sessions = new Map<string, SessionRecord>();

function parseCookies(cookieHeader?: string) {
  if (!cookieHeader) {
    return {};
  }
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex === -1) {
          return [part, ""];
        }
        return [part.slice(0, separatorIndex), decodeURIComponent(part.slice(separatorIndex + 1))];
      })
  );
}

function getConfiguredUsername() {
  return process.env.INVESTOR_CENTER_AUTH_USERNAME?.trim() || "admin";
}

function getConfiguredPassword() {
  return process.env.INVESTOR_CENTER_AUTH_PASSWORD?.trim() || "";
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS
  };
}

function readToken(req: Request) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE] ?? null;
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

function getSession(req: Request) {
  cleanupExpiredSessions();
  const token = readToken(req);
  if (!token) {
    return null;
  }
  const session = sessions.get(token);
  if (!session) {
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, session);
  return session;
}

export function isAuthConfigured() {
  return getConfiguredPassword().length > 0;
}

export function getAuthSessionState(req: Request) {
  const configured = isAuthConfigured();
  const username = getConfiguredUsername();
  if (!configured) {
    return {
      authenticated: false,
      configured: false,
      username
    };
  }
  const session = getSession(req);
  return {
    authenticated: Boolean(session),
    configured: true,
    username: session?.username ?? username
  };
}

export function loginWithPassword(username: string, password: string) {
  if (!isAuthConfigured()) {
    return {
      ok: false as const,
      configured: false,
      message: "Logowanie nie jest jeszcze skonfigurowane na serwerze."
    };
  }
  if (username !== getConfiguredUsername() || password !== getConfiguredPassword()) {
    return {
      ok: false as const,
      configured: true,
      message: "Nieprawidlowy login lub haslo."
    };
  }
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    username,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return {
    ok: true as const,
    configured: true,
    token,
    username
  };
}

export function applyAuthCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

export function clearAuthSession(req: Request, res: Response) {
  const token = readToken(req);
  if (token) {
    sessions.delete(token);
  }
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!isAuthConfigured()) {
    res.status(503).json({
      message: "Auth nie jest skonfigurowane. Ustaw INVESTOR_CENTER_AUTH_PASSWORD na serwerze."
    });
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({
      message: "Sesja wygasla albo nie jestes zalogowany."
    });
    return;
  }
  next();
}
