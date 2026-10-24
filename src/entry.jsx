import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from 'react-oidc-context';
import { WebStorageStateStore } from 'oidc-client-ts';
import { buildAuthConfig } from './auth/config.js';
import { AuthGate, ConfigProblem } from './auth/AuthGate.jsx';
import { RoleView } from './RoleView.jsx';

// App entry point. Cognito sign-in (AuthGate) asks the backend for the user's
// role with GET /me; RoleView then picks the charge nurse dashboard or the
// nurse view. The API enforces every permission.

// Sign-in configuration comes from public VITE_ settings (see .env.example).
const authConfig = buildAuthConfig(import.meta.env, { currentOrigin: window.location.origin });
const root = createRoot(document.getElementById('root'));

if (!authConfig.ok) {
  root.render(<ConfigProblem errors={authConfig.errors} />);
} else {
  root.render(
    <AuthProvider
      {...authConfig.value.oidc}
      // Tokens and in-flight sign-in state (state, nonce, PKCE verifier) are
      // kept in this tab's sessionStorage and cleared on sign-out.
      userStore={new WebStorageStateStore({ store: window.sessionStorage })}
      stateStore={new WebStorageStateStore({ store: window.sessionStorage })}
      // Remove ?code=&state= from the address bar after the callback.
      onSigninCallback={() => window.history.replaceState({}, document.title, '/')}
    >
      <AuthGate config={authConfig.value}>
        {(props) => <RoleView {...props} />}
      </AuthGate>
    </AuthProvider>,
  );
}
