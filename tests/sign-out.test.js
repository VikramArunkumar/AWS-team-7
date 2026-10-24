import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { signOut, clearOidcEntries, createNonce } from '../src/auth/session.js';

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()],
  };
}

const LOGOUT_URL = 'https://carebridge-dev.auth.us-east-1.amazoncognito.com/logout?client_id=abc&logout_uri=http%3A%2F%2Flocalhost%3A5173%2F';

describe('signOut', () => {
  test('clears app data, revokes the refresh token, removes the user and oidc storage, then ends the hosted session', async () => {
    const steps = [];
    const session = memoryStorage({ 'oidc.user:https://issuer:client': '{}', 'oidc.abc123': '{}', 'carebridge.theme': 'light' });
    const local = memoryStorage({ 'oidc.stale': '{}' });
    const auth = {
      revokeTokens: async (types) => { steps.push(['revoke', types]); },
      removeUser: async () => { steps.push(['removeUser']); },
    };

    await signOut({
      auth,
      logoutUrl: LOGOUT_URL,
      clearAppData: () => steps.push(['clearAppData']),
      storages: [session, local],
      navigate: (url) => steps.push(['navigate', url]),
    });

    assert.deepEqual(steps, [
      ['clearAppData'],
      ['revoke', ['refresh_token']],
      ['removeUser'],
      ['navigate', LOGOUT_URL],
    ]);
    assert.deepEqual(session.keys(), ['carebridge.theme']);
    assert.deepEqual(local.keys(), []);
  });

  test('still signs out locally when revocation fails', async () => {
    let navigated = null;
    let removed = false;
    await signOut({
      auth: {
        revokeTokens: async () => { throw new Error('network'); },
        removeUser: async () => { removed = true; },
      },
      logoutUrl: LOGOUT_URL,
      navigate: (url) => { navigated = url; },
    });
    assert.equal(removed, true);
    assert.equal(navigated, LOGOUT_URL);
  });
});

describe('session helpers', () => {
  test('clearOidcEntries only removes oidc-prefixed keys', () => {
    const storage = memoryStorage({ 'oidc.a': '1', other: '2' });
    clearOidcEntries(storage);
    assert.deepEqual(storage.keys(), ['other']);
  });

  test('createNonce returns 128 random bits as hex', () => {
    const a = createNonce();
    const b = createNonce();
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.notEqual(a, b);
  });
});
