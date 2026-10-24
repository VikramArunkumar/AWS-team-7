// Build and validate the browser sign-in configuration from Vite env values.
//
// Everything here is PUBLIC configuration: user pool id, app client id,
// hosted login domain, and redirect URLs are visible to any browser. Secrets
// (passwords, client secrets, AWS credentials) must never be placed in VITE_
// variables, because Vite inlines them into the shipped JavaScript.
//
// Pure module (no React, no import.meta) so it can be unit-tested in Node.

export const API_SCOPE = 'carebridge/access';
export const OIDC_SCOPE = `openid ${API_SCOPE}`;

export const REQUIRED_ENV = [
  'VITE_API_BASE_URL',
  'VITE_COGNITO_REGION',
  'VITE_COGNITO_USER_POOL_ID',
  'VITE_COGNITO_APP_CLIENT_ID',
  'VITE_COGNITO_DOMAIN',
  'VITE_AUTH_REDIRECT_URI',
  'VITE_AUTH_LOGOUT_URI',
];

// Guard against someone "fixing" a sign-in problem by shipping a secret.
const FORBIDDEN_ENV = /SECRET|PASSWORD|AWS_ACCESS_KEY|AWS_SESSION_TOKEN|PRIVATE_KEY/i;

const REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/;
const CLIENT_ID = /^[a-z0-9]{1,128}$/;

function isLoopback(url) {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function parseUrl(value, name, errors, { allowPath = true } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    errors.push(`${name} must be an absolute URL.`);
    return null;
  }
  if (url.protocol !== 'https:' && !isLoopback(url)) {
    errors.push(`${name} must use https (http is allowed only for localhost).`);
  }
  if (url.username || url.password) errors.push(`${name} must not contain credentials.`);
  if (url.hash) errors.push(`${name} must not contain a fragment.`);
  if (!allowPath && url.pathname !== '/') errors.push(`${name} must be an origin with no path.`);
  return url;
}

/**
 * @param {Record<string, string|undefined>} env  usually import.meta.env
 * @param {{ currentOrigin?: string }} [options]  window.location.origin in the browser
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export function buildAuthConfig(env, { currentOrigin } = {}) {
  const errors = [];

  for (const key of Object.keys(env ?? {})) {
    if (key.startsWith('VITE_') && FORBIDDEN_ENV.test(key)) {
      errors.push(`${key} looks like a secret. Remove it: Vite exposes every VITE_ variable to the browser.`);
    }
  }

  const missing = REQUIRED_ENV.filter((key) => !String(env?.[key] ?? '').trim());
  if (missing.length) errors.push(`Missing settings: ${missing.join(', ')}.`);
  if (errors.length) return { ok: false, errors };

  const region = env.VITE_COGNITO_REGION.trim();
  const userPoolId = env.VITE_COGNITO_USER_POOL_ID.trim();
  const clientId = env.VITE_COGNITO_APP_CLIENT_ID.trim();

  if (!REGION.test(region)) errors.push('VITE_COGNITO_REGION is not a valid AWS region.');
  if (!userPoolId.startsWith(`${region}_`)) errors.push('VITE_COGNITO_USER_POOL_ID must belong to VITE_COGNITO_REGION.');
  if (!CLIENT_ID.test(clientId)) errors.push('VITE_COGNITO_APP_CLIENT_ID is not a valid app client id.');

  const api = parseUrl(env.VITE_API_BASE_URL.trim(), 'VITE_API_BASE_URL', errors);
  const domain = parseUrl(env.VITE_COGNITO_DOMAIN.trim(), 'VITE_COGNITO_DOMAIN', errors, { allowPath: false });
  const redirect = parseUrl(env.VITE_AUTH_REDIRECT_URI.trim(), 'VITE_AUTH_REDIRECT_URI', errors);
  const logout = parseUrl(env.VITE_AUTH_LOGOUT_URI.trim(), 'VITE_AUTH_LOGOUT_URI', errors);
  if (domain && domain.protocol !== 'https:') errors.push('VITE_COGNITO_DOMAIN must use https.');
  if (api && (api.search || api.hash)) errors.push('VITE_API_BASE_URL must not include a query or fragment.');

  if (redirect && logout && redirect.origin !== logout.origin) {
    errors.push('VITE_AUTH_REDIRECT_URI and VITE_AUTH_LOGOUT_URI must share one origin.');
  }
  if (redirect && currentOrigin && redirect.origin !== currentOrigin) {
    errors.push(`Open CareBridge at ${redirect.origin}. Sign-in is configured for that address, not ${currentOrigin}.`);
  }
  if (errors.length) return { ok: false, errors };

  const domainUrl = domain.origin;
  const logoutUri = logout.href;
  return {
    ok: true,
    value: {
      apiBaseUrl: api.href.replace(/\/+$/, ''),
      oidc: {
        authority: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
        client_id: clientId,
        redirect_uri: redirect.href,
        response_type: 'code',
        scope: OIDC_SCOPE,
        loadUserInfo: false,
        automaticSilentRenew: true,
        // Cognito's revocation endpoint lives on the hosted login domain.
        metadataSeed: { revocation_endpoint: `${domainUrl}/oauth2/revoke` },
      },
      // Cognito ends its hosted-login session at /logout, then redirects to a
      // registered sign-out URL. Only public identifiers appear in this URL.
      logoutUrl: `${domainUrl}/logout?client_id=${encodeURIComponent(clientId)}&logout_uri=${encodeURIComponent(logoutUri)}`,
    },
  };
}

/** Map the backend's effective role to the screen set the UI shows. */
export function viewForRole(role) {
  if (role === 'charge_nurse') return 'charge';
  if (role === 'nurse') return 'nurse';
  return null;
}
