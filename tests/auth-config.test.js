import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthConfig, viewForRole, OIDC_SCOPE } from '../src/auth/config.js';

const ENV = Object.freeze({
  VITE_API_BASE_URL: 'https://abc123.execute-api.us-east-1.amazonaws.com/dev/',
  VITE_COGNITO_REGION: 'us-east-1',
  VITE_COGNITO_USER_POOL_ID: 'us-east-1_EXAMPLE',
  VITE_COGNITO_APP_CLIENT_ID: '1example23456789abcdefghij',
  VITE_COGNITO_DOMAIN: 'https://carebridge-dev.auth.us-east-1.amazoncognito.com',
  VITE_AUTH_REDIRECT_URI: 'http://localhost:5173/auth/callback',
  VITE_AUTH_LOGOUT_URI: 'http://localhost:5173/',
  MODE: 'development',
});

describe('buildAuthConfig', () => {
  test('builds an authorization-code OIDC config for the Cognito user pool', () => {
    const result = buildAuthConfig(ENV, { currentOrigin: 'http://localhost:5173' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const { oidc, apiBaseUrl, logoutUrl } = result.value;
    assert.equal(oidc.authority, 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXAMPLE');
    assert.equal(oidc.client_id, ENV.VITE_COGNITO_APP_CLIENT_ID);
    assert.equal(oidc.response_type, 'code');
    assert.equal(oidc.scope, OIDC_SCOPE);
    assert.ok(oidc.scope.split(' ').includes('carebridge/access'));
    assert.equal(oidc.redirect_uri, ENV.VITE_AUTH_REDIRECT_URI);
    assert.equal(oidc.metadataSeed.revocation_endpoint, `${ENV.VITE_COGNITO_DOMAIN}/oauth2/revoke`);
    assert.equal(apiBaseUrl, 'https://abc123.execute-api.us-east-1.amazonaws.com/dev');
    assert.equal(oidc.client_secret, undefined);
    assert.equal(
      logoutUrl,
      'https://carebridge-dev.auth.us-east-1.amazoncognito.com/logout?client_id=1example23456789abcdefghij&logout_uri=http%3A%2F%2Flocalhost%3A5173%2F',
    );
  });

  test('reports missing settings by name', () => {
    const result = buildAuthConfig({ ...ENV, VITE_COGNITO_APP_CLIENT_ID: '', VITE_AUTH_LOGOUT_URI: undefined });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /VITE_COGNITO_APP_CLIENT_ID/);
    assert.match(result.errors.join(' '), /VITE_AUTH_LOGOUT_URI/);
  });

  test('refuses to start when a secret-looking variable is present', () => {
    for (const key of ['VITE_COGNITO_CLIENT_SECRET', 'VITE_AWS_SECRET_ACCESS_KEY', 'VITE_AWS_ACCESS_KEY_ID', 'VITE_ADMIN_PASSWORD']) {
      const result = buildAuthConfig({ ...ENV, [key]: 'x' });
      assert.equal(result.ok, false, key);
      assert.match(result.errors[0], new RegExp(key));
    }
  });

  test('requires https outside localhost', () => {
    const result = buildAuthConfig({
      ...ENV,
      VITE_AUTH_REDIRECT_URI: 'http://carebridge.example.org/auth/callback',
      VITE_AUTH_LOGOUT_URI: 'http://carebridge.example.org/',
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /https/);
  });

  test('accepts an https deployment', () => {
    const result = buildAuthConfig({
      ...ENV,
      VITE_AUTH_REDIRECT_URI: 'https://carebridge.example.org/auth/callback',
      VITE_AUTH_LOGOUT_URI: 'https://carebridge.example.org/',
    }, { currentOrigin: 'https://carebridge.example.org' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  test('flags opening the app on a different origin than the registered callback', () => {
    const result = buildAuthConfig(ENV, { currentOrigin: 'http://127.0.0.1:5173' });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /Open CareBridge at http:\/\/localhost:5173/);
  });

  test('rejects a pool id from another region and a domain with a path', () => {
    const result = buildAuthConfig({
      ...ENV,
      VITE_COGNITO_USER_POOL_ID: 'eu-west-1_EXAMPLE',
      VITE_COGNITO_DOMAIN: 'https://carebridge-dev.auth.us-east-1.amazoncognito.com/login',
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 2);
  });
});

describe('viewForRole', () => {
  test('maps only the two backend roles', () => {
    assert.equal(viewForRole('charge_nurse'), 'charge');
    assert.equal(viewForRole('nurse'), 'nurse');
    assert.equal(viewForRole('admin'), null);
    assert.equal(viewForRole(undefined), null);
  });
});
