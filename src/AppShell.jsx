import React, { useState } from 'react';
import { LogOut, Construction, UserRound } from 'lucide-react';
import { getCurrentUser, signOut } from './auth.js';
import Login from './Login.jsx';
import ChargeNurseApp from './main.jsx';

// CareBridge role routing shell — FRONTEND ONLY, NO BACKEND.
//
// Decides which experience to show based on the signed-in demo account's role
// (FR-3). This is presentation routing, not security: it only hides screens.
// Real role enforcement must live in the backend per AGENTS.md.

// A small banner shown over whichever role app is active, giving the signed-in
// user, their role, and a sign-out control (FR-4). Fixed so it sits above the
// existing dashboard's own fixed sidebar/topbar without disturbing them.
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

// Placeholder for role apps teammates are building (nurse view, admin panel).
// Keeps the routing complete and demoable without claiming the feature exists.
function ComingSoon({ title, description }) {
  return (
    <div className="role-placeholder">
      <div className="panel role-placeholder-card">
        <span className="role-placeholder-icon"><Construction size={28} /></span>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="notice">
          This area is reserved for a teammate's frontend. Role routing lands the right user here;
          the screen itself is not built in this branch.
        </div>
      </div>
    </div>
  );
}

export default function AppShell() {
  const [user, setUser] = useState(() => getCurrentUser());

  const handleSignOut = () => {
    signOut();
    setUser(null);
  };

  if (!user) {
    return <Login onSignIn={setUser} />;
  }

  let roleApp;
  if (user.role === 'charge-nurse') {
    roleApp = <ChargeNurseApp />;
  } else if (user.role === 'nurse') {
    roleApp = (
      <ComingSoon
        title="Nurse workspace"
        description="Submit patient updates and review your assigned tasks. Built by the nurse-experience team."
      />
    );
  } else {
    roleApp = (
      <ComingSoon
        title="Administration"
        description="Configure users, synthetic patient data, and facility policies. Built by the admin team."
      />
    );
  }

  return (
    <div className="shell-root">
      <SessionBar user={user} onSignOut={handleSignOut} />
      <div className="shell-body">{roleApp}</div>
    </div>
  );
}
