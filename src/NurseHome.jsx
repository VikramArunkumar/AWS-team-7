// Nurse landing view. Nurses sign in and are verified like everyone else,
// but charge-only screens (the unit dashboard, AI review, staffing) are not
// shown to them, and the API rejects those requests for the nurse role.
// Nurse update submission and the assigned-task list are not wired up yet.

import React from 'react';
import { ClipboardList, FileText, LogOut, Plus, ShieldCheck } from 'lucide-react';
import { initialsFor } from './auth/AuthGate.jsx';

export function NurseHome({ me, onSignOut }) {
  const firstName = String(me.displayName).split(/\s+/)[0] || me.displayName;
  return (
    <div className="nurse-shell">
      <header className="topbar nurse-topbar">
        <div className="brand nurse-brand"><span className="brand-mark"><Plus size={22} strokeWidth={3} /></span>CareBridge<span className="brand-period">.</span></div>
        <div className="topbar-right">
          <span className="demo-label"><span /> Synthetic data</span>
          <span className="avatar top-avatar" aria-hidden="true">{initialsFor(me.displayName)}</span>
          <button className="secondary-button" onClick={onSignOut}><LogOut size={15} aria-hidden="true" /> Sign out</button>
        </div>
      </header>
      <main className="nurse-main">
        <section className="page-heading">
          <div>
            <div className="eyebrow">NURSE WORKSPACE</div>
            <h1>Welcome, {firstName}.</h1>
            <p>You're signed in. CareBridge confirmed your account and role.</p>
          </div>
        </section>
        <section className="panel nurse-panel">
          <div className="panel-heading"><div><h2><ShieldCheck size={17} className="teal-text" aria-hidden="true" /> Your CareBridge account</h2><p>Verified by the CareBridge API.</p></div></div>
          <dl className="detail-grid nurse-details">
            <dt>Name</dt><dd>{me.displayName}</dd>
            <dt>CareBridge user</dt><dd>{me.userId}</dd>
            <dt>Role</dt><dd>Nurse</dd>
          </dl>
        </section>
        <section className="nurse-next">
          <div className="panel nurse-tile"><FileText size={20} aria-hidden="true" /><h3>Submit a patient update</h3><p>Not connected in this build.</p></div>
          <div className="panel nurse-tile"><ClipboardList size={20} aria-hidden="true" /><h3>Your assigned tasks</h3><p>Not connected in this build.</p></div>
        </section>
        <p className="page-note">The unit dashboard, AI review, and staffing views are limited to charge nurses. The API enforces the same rule.</p>
      </main>
    </div>
  );
}
