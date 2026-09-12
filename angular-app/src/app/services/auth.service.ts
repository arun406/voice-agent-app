import { Injectable, signal } from '@angular/core';
import { ZITADEL_CLIENT_ID, ZITADEL_ISSUER, ZITADEL_REDIRECT_URI, ZITADEL_SCOPES } from '../config/auth.config';

declare const window: any;

interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
}

const STORAGE_KEY = 'voiceagent.auth.tokens';

/**
 * Zitadel login via OAuth2 Authorization Code + PKCE — the flow Zitadel recommends
 * for native apps, since a mobile app can't keep a client secret safe. Runs the
 * authorize step in an in-app browser tab (cordova-plugin-inappbrowser) rather than
 * the system browser: it needs no AndroidManifest/native changes to catch the
 * redirect (see login() below), at the cost of not sharing cookies with the system
 * browser — if your company later wants true SSO (already-logged-in-elsewhere
 * skips the credential prompt), that's the thing to revisit.
 *
 * Tokens are cached in localStorage for now. That's fine for development but is a
 * plain-text store any other code (or a rooted device) can read — before a real
 * field rollout, swap STORAGE_KEY's reads/writes here for a secure-storage Cordova
 * plugin (e.g. cordova-plugin-secure-storage-echo) without touching callers.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly isAuthenticated = signal<boolean>(this.readTokens() !== null);
  readonly isAuthenticating = signal<boolean>(false);

  /** Returns a valid access token, refreshing it first if it's expired. Triggers login() if there's no way to get one silently. */
  async getAccessToken(): Promise<string> {
    let tokens = this.readTokens();
    if (tokens && tokens.expiresAt - 30_000 > Date.now()) {
      return tokens.accessToken;
    }
    if (tokens?.refreshToken) {
      try {
        tokens = await this.refresh(tokens.refreshToken);
        return tokens.accessToken;
      } catch {
        this.clearTokens();
      }
    }
    tokens = await this.login();
    return tokens.accessToken;
  }

  /** Opens the Zitadel-hosted login page and resolves once tokens are obtained. */
  async login(): Promise<StoredTokens> {
    if (!window.cordova?.InAppBrowser) {
      throw new Error('Login requires the device build (cordova-plugin-inappbrowser) — not available in browser preview.');
    }
    this.isAuthenticating.set(true);
    try {
      const codeVerifier = randomUrlSafeString(64);
      const codeChallenge = await sha256Base64Url(codeVerifier);
      const state = randomUrlSafeString(24);

      const authorizeUrl =
        `${ZITADEL_ISSUER}/oauth/v2/authorize?` +
        `client_id=${encodeURIComponent(ZITADEL_CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(ZITADEL_REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(ZITADEL_SCOPES)}` +
        `&state=${encodeURIComponent(state)}` +
        `&code_challenge=${encodeURIComponent(codeChallenge)}` +
        `&code_challenge_method=S256`;

      const code = await this.runAuthorizeFlow(authorizeUrl, state);
      const tokens = await this.exchangeCodeForTokens(code, codeVerifier);
      this.writeTokens(tokens);
      this.isAuthenticated.set(true);
      return tokens;
    } finally {
      this.isAuthenticating.set(false);
    }
  }

  logout(): void {
    this.clearTokens();
    this.isAuthenticated.set(false);
    // Not calling Zitadel's end_session endpoint here — this only forgets the local
    // token, so a fresh login() may not re-prompt for credentials if the in-app
    // browser retained a session cookie. Add end_session if that's a problem for you.
  }

  /** Opens the InAppBrowser tab and resolves with the `code` param once the redirect URI is hit. */
  private runAuthorizeFlow(authorizeUrl: string, expectedState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const browserRef = window.cordova.InAppBrowser.open(authorizeUrl, '_blank', 'location=yes,hidden=no');
      let settled = false;

      const onLoadStart = (event: any) => {
        const url: string = event.url ?? '';
        if (!url.startsWith(ZITADEL_REDIRECT_URI)) return;
        settled = true;
        browserRef.removeEventListener('loadstart', onLoadStart);
        browserRef.removeEventListener('exit', onExit);
        browserRef.close();

        const params = new URL(url).searchParams;
        const error = params.get('error');
        if (error) {
          reject(new Error(`Login failed: ${error} — ${params.get('error_description') ?? ''}`));
          return;
        }
        if (params.get('state') !== expectedState) {
          reject(new Error('Login failed: state mismatch (possible CSRF) — try again.'));
          return;
        }
        const code = params.get('code');
        if (!code) {
          reject(new Error('Login failed: no authorization code in redirect.'));
          return;
        }
        resolve(code);
      };

      const onExit = () => {
        if (!settled) reject(new Error('Login cancelled.'));
      };

      browserRef.addEventListener('loadstart', onLoadStart);
      browserRef.addEventListener('exit', onExit);
    });
  }

  private async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<StoredTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: ZITADEL_REDIRECT_URI,
      client_id: ZITADEL_CLIENT_ID,
      code_verifier: codeVerifier
    });
    return this.postTokenRequest(body);
  }

  private async refresh(refreshToken: string): Promise<StoredTokens> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: ZITADEL_CLIENT_ID
    });
    const tokens = await this.postTokenRequest(body);
    this.writeTokens(tokens);
    return tokens;
  }

  private async postTokenRequest(body: URLSearchParams): Promise<StoredTokens> {
    const res = await fetch(`${ZITADEL_ISSUER}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!res.ok) {
      throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
    }
    const json = await res.json();
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? undefined,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000
    };
  }

  private readTokens(): StoredTokens | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as StoredTokens) : null;
    } catch {
      return null;
    }
  }

  private writeTokens(tokens: StoredTokens): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  }

  private clearTokens(): void {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function randomUrlSafeString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
