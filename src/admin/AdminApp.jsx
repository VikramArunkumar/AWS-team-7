import React from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import AdminDashboard from './AdminDashboard.jsx';
import '../styles.css';

// Administrator console UI. Rendered by the login shell (AppShell) for the
// admin role, so the administrator surface is only shown to an admin session
// (FR-3, NFR-8). There is still no backend here; the signed-in admin is a
// demo persona from the client-side mock login, and every control inside
// AdminDashboard remains a disabled or preview-only affordance. Real
// role enforcement must come from the backend.
export default function AdminApp() {
  return (
    <div className="admin-app">
      <header className="admin-app-topbar">
        <span className="brand admin-app-brand">
          <span className="brand-mark"><Plus size={22} strokeWidth={3} /></span>
          CareBridge<span className="brand-period">.</span>
          <span className="admin-app-console-tag">Administrator console</span>
        </span>
        <div className="admin-app-topbar-right">
          <span className="demo-label"><span /> Administrator console · synthetic data</span>
          <span className="topbar-divider" />
          <div className="admin-app-profile">
            <span className="avatar admin-app-avatar">DA</span>
            <div>
              <strong>Demo Admin (fixture)</strong>
              <span>System administrator · Demo profile</span>
            </div>
          </div>
        </div>
      </header>

      <div className="admin-app-banner">
        <span className="admin-app-banner-icon"><ShieldCheck size={16} /></span>
        <div>
          <strong>Administrator console</strong>
          <p>
            This console is reached through the in-app login and role routing. It is a local visual prototype with no
            authentication: the administrator profile is a labelled demo fixture, and every management control
            is a disabled or preview-only affordance. Role-based access must be enforced by an authorized
            backend before any control becomes live (NFR-8). Hiding a surface is not authorization.
          </p>
        </div>
      </div>

      <main className="admin-app-main">
        <section className="admin-app-heading">
          <div className="eyebrow">WESTBROOK MEDICAL · ADMINISTRATION</div>
          <h1>Configure the environment.</h1>
          <p>Review users, synthetic patient fixtures, facility policy documents, and incident configuration.</p>
        </section>

        <AdminDashboard />

        <footer className="page-footer">
          <span>
            <span className="brand-mini"><Plus size={12} strokeWidth={3} /></span> CareBridge
            <span>·</span> Administrator console
          </span>
          <span>Separate local prototype <span>·</span> Times in Pacific</span>
        </footer>
      </main>
    </div>
  );
}
