// Session helpers shared by the auth UI. Pure functions over injected
// dependencies so they can be unit-tested in Node.

/** Cryptographically random nonce, validated by oidc-client-ts against the ID token. */
export function createNonce(cryptoImpl = globalThis.crypto) {
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Remove oidc-client-ts entries (user, state, PKCE verifier) from a Web Storage area. */
export function clearOidcEntries(storage, prefix = 'oidc.') {
  if (!storage) return;
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

/**
 * Sign out of CareBridge:
 *   1. clear protected application data held in memory (clearAppData)
 *   2. revoke the refresh token at Cognito (best effort)
 *   3. remove the stored user and any leftover sign-in state
 *   4. send the browser to Cognito /logout to end the hosted-login session
 *
 * An access token already issued stays valid at API Gateway until it expires
 * (30 minutes); see README. Revocation failures never block local sign-out.
 */
export async function signOut({ auth, logoutUrl, clearAppData, storages = [], navigate }) {
  clearAppData?.();
  try {
    await auth.revokeTokens(['refresh_token']);
  } catch {
    // Best effort: continue signing out locally.
  }
  try {
    await auth.removeUser();
  } catch {
    // Continue; storage is cleared below regardless.
  }
  for (const storage of storages) clearOidcEntries(storage);
  navigate(logoutUrl);
}
