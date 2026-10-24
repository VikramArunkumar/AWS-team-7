import React, { useState } from 'react';
import { LogOut, Construction, UserRound } from 'lucide-react';
import { getCurrentUser, signOut } from './auth.js';
import Login from './Login.jsx';
import { App as ChargeNurseApp, NurseView } from './main.jsx';

// CareBridge role routing shell — FRONTEND ONLY, NO BACKEND.
//
// After a client-side demo sign-in, routes each role to its experience
// (FR-3): charge nurse -> charge dashboard (App), nurse -> NurseView, admin ->
// placeholder (until the admin dashboard is integrated). This is presentation
// routing, not security; real role enforcement must live in the backend.
//
// The charge and nurse views already accept role/setRole to drive their
// in-view role toggle. We feed those from the signed-in session so the toggle
// still works as a quick switch during a demo, while sign-out returns to login.

function SessionBar({ user, onSignOut }) {
  return (
    <div className="session-bar" role="region" aria-label="Session">
      <span className="session-role">
        <span className={`badge ${user.roleTone}`}><UserRound size={11} />{user.roleLabel}</span>
      </span>
      <span className="session-user">
        <strong>{user.name}</strong>
        <small>{user.email}</small>
      </span>
      <button className="secondary-button session-signout" onClick={onSignOut}>
        <LogOut size={15} /> Sign out
      </button>
    </div>
  );
}

function ComingSoon({ title, description }) {
  return (
    <div className="role-placeholder">
      <div className="panel role-placeholder-card">
        <span className="role-placeholder-icon"><Construction size={28} /></span>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="notice">
          This area is reserved for a teammate's frontend. Role routing lands the right user here;
          the screen itself is not integrated in this branch.
        </div>
      </div>
    </div>
  );
}

// Map the signed-in session role to the view-prop role the charge/nurse
// components expect ('charge' | 'nurse') for their in-view toggle.
const toViewRole = (sessionRole) => (sessionRole === 'nurse' ? 'nurse' : 'charge');

export default function AppShell() {
  const [user, setUser] = useState(() => getCurrentUser());
  // Drives the charge/nurse in-view toggle after login. Initialized from the
  // signed-in role; the toggle can switch between charge and nurse views
  // without signing out (useful for the demo). Admin is routed separately.
  const [viewRole, setViewRole] = useState(() => toViewRole(user?.role));

  const handleSignIn = (session) => {
    setUser(session);
    setViewRole(toViewRole(session.role));
  };

  const handleSignOut = () => {
    signOut();
    setUser(null);
  };

  if (!user) {
    return <Login onSignIn={handleSignIn} />;
  }

  let roleApp;
  if (user.role === 'admin') {
    roleApp = (
      <ComingSoon
        title="Administration"
        description="Configure users, synthetic patient data, and facility policies. Built by the admin team; not yet integrated into role routing."
      />
    );
  } else if (viewRole === 'nurse') {
    roleApp = <NurseView role={viewRole} setRole={setViewRole} />;
  } else {
    roleApp = <ChargeNurseApp role={viewRole} setRole={setViewRole} />;
  }

  return (
    <div className="shell-root">
      <SessionBar user={user} onSignOut={handleSignOut} />
      <div className="shell-body">{roleApp}</div>
    </div>
  );
}
