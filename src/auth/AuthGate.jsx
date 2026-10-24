// Authentication gate (FR-1 to FR-4).
//
// States: configuration problem -> connecting -> signed out -> checking access
// (GET /me) -> ready. The UI chooses screens from the role the BACKEND reports
// in /me, not from token contents; every protected action is still enforced
// by the API.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { LoaderCircle, LogIn, LogOut, Plus, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { createApiClient, SessionExpiredError } from '../api/client.js';
import { createNonce, signOut as performSignOut } from './session.js';
import { viewForRole } from './config.js';

export function initialsFor(name) {
  const parts = String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0].toUpperCase()).join('') || '?';
}

function AuthScreen({ title, busy = false, children }) {
  return (
    <main className="auth-screen">
      <section className="panel auth-card" aria-busy={busy} aria-live="polite">
        <div className="brand auth-brand"><span className="brand-mark"><Plus size={24} strokeWidth={3} /></span>CareBridge<span className="brand-period">.</span></div>
        <h1>{busy && <LoaderCircle className="auth-spinner" size={20} aria-hidden="true" />}{title}</h1>
        {children}
        <p className="auth-footnote"><ShieldCheck size={13} aria-hidden="true" /> Synthetic data only. CareBridge supports coordination and does not make clinical decisions.</p>
      </section>
    </main>
  );
}

export function ConfigProblem({ errors }) {
  return (
    <AuthScreen title="Sign-in isn't configured">
      <p className="auth-lead">This build of CareBridge is missing or has invalid sign-in settings. Ask the person who deployed it to check the frontend configuration.</p>
      <ul className="auth-error-list">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
    </AuthScreen>
  );
}

const ACCESS_PROBLEMS = {
  not_provisioned: ["Your account isn't set up yet", 'You signed in, but an administrator still needs to connect your account to CareBridge.'],
  role_missing: ['Your role needs attention', null],
  role_conflict: ['Your role needs attention', null],
  role_unrecognized: ['Your role needs attention', null],
  role_mismatch: ['Your role needs attention', null],
  insufficient_scope: ["This sign-in can't open CareBridge", null],
  network_error: ["CareBridge can't be reached", null],
};

function AccessProblem({ error, onRetry, onSignOut }) {
  const [title, lead] = ACCESS_PROBLEMS[error?.code] ?? ["We couldn't confirm your access", null];
  return (
    <AuthScreen title={title}>
      <div className="notice amber-notice auth-notice" role="alert"><TriangleAlert size={16} aria-hidden="true" /><span>{lead ?? error?.message ?? 'Try again in a moment.'}</span></div>
      <div className="auth-actions">
        <button className="primary-button" onClick={onRetry}><RefreshCw size={15} aria-hidden="true" /> Try again</button>
        <button className="secondary-button" onClick={onSignOut}><LogOut size={15} aria-hidden="true" /> Sign out</button>
      </div>
    </AuthScreen>
  );
}

export function AuthGate({ config, children }) {
  const auth = useAuth();
  const { removeUser, events, signinRedirect, clearStaleState } = auth;
  const [me, setMe] = useState(null);
  const [meStatus, setMeStatus] = useState('idle'); // idle | loading | ready | error
  const [meError, setMeError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState(null); // 'expired' | null
  const [signingOut, setSigningOut] = useState(false);

  // Read the latest user at request time so renewed tokens are used.
  const userRef = useRef(auth.user);
  userRef.current = auth.user;
  const api = useMemo(() => createApiClient({
    baseUrl: config.apiBaseUrl,
    getAccessToken: () => {
      const user = userRef.current;
      return user && !user.expired ? user.access_token : null;
    },
  }), [config.apiBaseUrl]);

  const clearAppData = useCallback(() => {
    setMe(null);
    setMeStatus('idle');
    setMeError(null);
  }, []);

  const expireSession = useCallback(async () => {
    clearAppData();
    setNotice('expired');
    try { await removeUser(); } catch { /* already removed */ }
  }, [clearAppData, removeUser]);

  // If silent renewal did not replace the access token in time, end the session.
  useEffect(() => events.addAccessTokenExpired(() => { void expireSession(); }), [events, expireSession]);

  // Whenever the session ends, drop protected data held in memory.
  useEffect(() => {
    if (!auth.isAuthenticated) clearAppData();
  }, [auth.isAuthenticated, clearAppData]);

  // Never leave an authorization response (code/state/error) in the address bar.
  useEffect(() => {
    if (auth.isLoading) return;
    const url = new URL(window.location.href);
    if (url.pathname.endsWith('/auth/callback') || url.searchParams.has('code') || url.searchParams.has('state')) {
      window.history.replaceState({}, document.title, '/');
    }
  }, [auth.isLoading, auth.error]);

  // Confirm backend authentication and fetch the effective identity.
  const sub = auth.user?.profile?.sub;
  useEffect(() => {
    if (!auth.isAuthenticated || !sub) return undefined;
    let cancelled = false;
    setMeStatus('loading');
    setMeError(null);
    api.getMe().then((data) => {
      if (cancelled) return;
      setMe(data);
      setMeStatus('ready');
      setNotice(null);
    }).catch((err) => {
      if (cancelled) return;
      if (err instanceof SessionExpiredError || err?.status === 401) {
        void expireSession();
      } else {
        setMeError(err);
        setMeStatus('error');
      }
    });
    return () => { cancelled = true; };
  }, [auth.isAuthenticated, sub, api, expireSession, attempt]);

  const signIn = useCallback(() => {
    setNotice(null);
    void signinRedirect({ nonce: createNonce() });
  }, [signinRedirect]);

  const retrySignIn = useCallback(async () => {
    try { await clearStaleState(); } catch { /* nothing stale */ }
    signIn();
  }, [clearStaleState, signIn]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    await performSignOut({
      auth,
      logoutUrl: config.logoutUrl,
      clearAppData,
      storages: [window.sessionStorage, window.localStorage],
      navigate: (url) => window.location.assign(url),
    });
  }, [auth, config.logoutUrl, clearAppData]);

  if (signingOut) {
    return <AuthScreen title="Signing you out" busy><p className="auth-lead">Ending your CareBridge session.</p></AuthScreen>;
  }
  if (auth.isLoading || auth.activeNavigator) {
    return <AuthScreen title="Connecting to sign-in" busy><p className="auth-lead">One moment.</p></AuthScreen>;
  }
  // A failed background renewal is handled as session expiry, not a sign-in error.
  const signInError = auth.error && auth.error.source !== 'renewSilent' ? auth.error : null;
  if (signInError && !auth.isAuthenticated) {
    // OAuth/OIDC error details stay out of the UI; they can echo request data.
    return (
      <AuthScreen title="Sign-in didn't complete">
        <div className="notice amber-notice auth-notice" role="alert"><TriangleAlert size={16} aria-hidden="true" /><span>Your sign-in couldn't be confirmed. Start again to continue.</span></div>
        <div className="auth-actions"><button className="primary-button" onClick={retrySignIn}><LogIn size={15} aria-hidden="true" /> Sign in again</button></div>
      </AuthScreen>
    );
  }
  if (!auth.isAuthenticated) {
    const expired = notice === 'expired' || auth.error?.source === 'renewSilent';
    return (
      <AuthScreen title={expired ? 'Your session ended' : 'Sign in to CareBridge'}>
        <p className="auth-lead">
          {expired
            ? 'For your security, you were signed out. Sign in again to keep coordinating care.'
            : 'Use the account your administrator created for you. You will continue on the secure Cognito sign-in page.'}
        </p>
        <div className="auth-actions"><button className="primary-button" onClick={signIn}><LogIn size={15} aria-hidden="true" /> Sign in</button></div>
      </AuthScreen>
    );
  }
  if (meStatus === 'error') {
    return <AccessProblem error={meError} onRetry={() => setAttempt((n) => n + 1)} onSignOut={handleSignOut} />;
  }
  if (meStatus !== 'ready' || !me) {
    return <AuthScreen title="Checking your access" busy><p className="auth-lead">Confirming your CareBridge role.</p></AuthScreen>;
  }

  const view = viewForRole(me.role);
  if (!view) {
    return <AccessProblem error={{ code: 'role_unrecognized', message: 'Your CareBridge role is not recognized.' }} onRetry={() => setAttempt((n) => n + 1)} onSignOut={handleSignOut} />;
  }
  return children({ me, view, signOut: handleSignOut });
}
