import type { AuthSession, User } from '@podcast/shared';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { clearRefreshToken, loadRefreshToken, saveRefreshToken } from './refresh-token';

import { ApiError, request } from '@/api/client';
import { persistStorage } from '@/storage/persist';

const CLIENT = Platform.OS === 'web' ? 'web' : 'native';
/** Refresh a little before the access token expires, so a request never races its expiry. */
const EXPIRY_MARGIN_MS = 30_000;

type AuthState = {
  /** The signed-in account, kept across launches so the app knows it's signed in while offline. */
  user: User | null;
};

export const useAuth = create<AuthState>()(
  persist((): AuthState => ({ user: null }), { name: 'auth', version: 1, storage: persistStorage<AuthState>() }),
);

// The access token stays in memory only; a new one comes from the refresh token when needed.
let access: { token: string; expiresAt: number } | null = null;
let refreshing: Promise<boolean> | null = null;

/** Auth endpoints carry the web refresh cookie, which lives on the API's origin. */
const authRequest = <T>(path: string, init: RequestInit) => request<T>(path, { ...init, credentials: 'include' });

async function adopt(session: AuthSession) {
  access = { token: session.accessToken, expiresAt: Date.parse(session.accessTokenExpiresAt) };
  if (session.refreshToken) await saveRefreshToken(session.refreshToken);
  useAuth.setState({ user: session.user });
}

async function forgetSession() {
  access = null;
  await clearRefreshToken();
  useAuth.setState({ user: null });
}

/** F-12: emails a sign-in link and code. */
export function startEmailSignIn(email: string) {
  return request<void>('/v1/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) });
}

/** Completes sign-in with the emailed code (any device) or the link's token (web). */
export async function verifySignIn(input: { email: string; code: string } | { token: string }): Promise<User> {
  const session = await authRequest<AuthSession>('/v1/auth/email/verify', {
    method: 'POST',
    body: JSON.stringify({ ...input, client: CLIENT }),
  });
  await adopt(session);
  return session.user;
}

/**
 * Gets a new access token from the refresh token. Resolves false when the server says the
 * session is over (and signs out locally); throws on network errors, keeping the session.
 */
function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const refreshToken = await loadRefreshToken();
      if (CLIENT === 'native' && !refreshToken) {
        await forgetSession();
        return false;
      }
      const session = await authRequest<AuthSession>('/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ client: CLIENT, ...(refreshToken && { refreshToken }) }),
      });
      await adopt(session);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await forgetSession();
        return false;
      }
      throw err;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** A request as the signed-in user; refreshes the access token once if it has expired. */
export async function authedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const signedOut = () => new ApiError('Sign in to sync.', 401, 'signed_out');
  if (!useAuth.getState().user) throw signedOut();
  if (!access || access.expiresAt - EXPIRY_MARGIN_MS <= Date.now()) {
    if (!(await refresh())) throw signedOut();
  }
  const send = () =>
    request<T>(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${access!.token}` } });
  try {
    return await send();
  } catch (err) {
    // The token may have been revoked or the server restarted with a new secret: refresh once.
    if (!(err instanceof ApiError && err.status === 401) || !(await refresh())) throw err;
    return send();
  }
}

export async function signOut() {
  try {
    await authedRequest<void>('/v1/auth/sign-out', { method: 'POST', credentials: 'include' });
  } catch {
    // Signing out locally matters more than telling the server; the session expires anyway.
  }
  await forgetSession();
}

/** Deletes the account and its synced data on the server; what's on this device stays. */
export async function deleteAccount() {
  await authedRequest<void>('/v1/me', { method: 'DELETE', credentials: 'include' });
  await forgetSession();
}
