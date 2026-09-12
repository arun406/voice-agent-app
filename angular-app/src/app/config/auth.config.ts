/**
 * Zitadel OIDC settings — Authorization Code + PKCE (the flow Zitadel recommends for
 * native/mobile apps, since there's no safe place to hold a client secret on-device).
 * Replace these with your real values once the Native app is registered in Zitadel.
 */

/** Your Zitadel instance, e.g. "https://your-instance-xyz.zitadel.cloud" (no trailing slash). */
export const ZITADEL_ISSUER = 'https://your-instance.zitadel.cloud';

/** Client ID of a Zitadel "Native" application (PKCE, no client secret). */
export const ZITADEL_CLIENT_ID = 'your-zitadel-client-id';

/**
 * Must be registered as a redirect URI on the Zitadel application. Custom scheme (not
 * https) because there's no web server on-device to receive the browser redirect —
 * AuthService intercepts navigation to this URL from inside the InAppBrowser tab
 * before the WebView tries (and fails) to actually load it.
 */
export const ZITADEL_REDIRECT_URI = 'com.nothing.voiceagent://callback';

/**
 * openid/profile/email are standard OIDC scopes for identity. Add your backend/MCP
 * API's own scope or audience here too (Zitadel project APIs usually need to be
 * requested explicitly) — e.g. 'urn:zitadel:iam:org:project:id:<project-id>:aud' or a
 * custom scope name your backend team defines. Without it the resulting token may be
 * valid for login but rejected by the backend/MCP server as not carrying its audience.
 */
export const ZITADEL_SCOPES = 'openid profile email offline_access';
