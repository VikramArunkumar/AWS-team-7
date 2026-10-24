import React, { useState } from 'react';
import { ArrowRight, Plus, ShieldCheck, Lock, Mail, UserRound } from 'lucide-react';
import { demoAccounts, signIn } from './auth.js';

// CareBridge demo login — FRONTEND ONLY. See auth.js for the no-backend note.
// Reuses the dashboard theme (styles.css): teal palette, Manrope/DM Sans,
// .primary-button, .badge tones, brand mark.
export default function Login({ onSignIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = (event) => {
    event.preventDefault();
    try {
      const session = signIn(email, password);
      setError('');
      onSignIn(session);
    } catch (err) {
      setError(err.message);
    }
  };

  // Clicking a quick sign-in only auto-fills the fields; the user still presses
  // Sign in. This keeps the email/password path primary and the buttons a shortcut.
  const prefill = (account) => {
    setEmail(account.email);
    setPassword(account.password);
    setError('');
  };

  return (
    <div className="login-screen">
      <div className="login-card panel">
        <a className="brand login-brand" href="#" onClick={(event) => event.preventDefault()}>
          <span className="brand-mark"><Plus size={24} strokeWidth={3} /></span>
          CareBridge<span className="brand-period">.</span>
        </a>
        <span className="eyebrow login-eyebrow">WESTBROOK MEDICAL · CARE COORDINATION</span>
        <h1 className="login-title">Sign in to continue.</h1>
        <p className="login-lead">Secure, role-based access keeps the right view in front of the right person.</p>

        <form className="login-form" onSubmit={submit}>
          <label className="login-label" htmlFor="login-email">Email</label>
          <div className="login-input">
            <Mail size={16} />
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@westbrook.demo"
            />
          </div>

          <label className="login-label" htmlFor="login-password">Password</label>
          <div className="login-input">
            <Lock size={16} />
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter any password for the demo"
            />
          </div>

          {error && <p className="login-error" role="alert">{error}</p>}

          <button className="primary-button login-submit" type="submit">
            Sign in <ArrowRight size={16} />
          </button>
        </form>

        <div className="login-divider"><span>Quick sign-in · synthetic accounts</span></div>

        <div className="login-accounts">
          {demoAccounts.map((account) => (
            <button
              type="button"
              className="login-account"
              key={account.email}
              onClick={() => prefill(account)}
              aria-label={`Fill demo credentials for ${account.name}, ${account.roleLabel}`}
            >
              <span className={`avatar ${account.roleTone === 'teal' ? 'green' : account.roleTone === 'amber' ? 'peach' : 'blue'}`}>
                {account.initials}
              </span>
              <span className="login-account-text">
                <strong>{account.name}</strong>
                <small>{account.email}</small>
              </span>
              <span className={`badge ${account.roleTone}`}><UserRound size={11} />{account.roleLabel}</span>
            </button>
          ))}
        </div>

        <p className="login-note">
          <ShieldCheck size={13} /> Demo sign-in only. These are synthetic accounts with no real
          authentication. Backend sign-in and role enforcement are not connected.
        </p>
      </div>
    </div>
  );
}
