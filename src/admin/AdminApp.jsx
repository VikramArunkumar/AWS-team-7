import React from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import AdminDashboard from './AdminDashboard.jsx';
import '../styles.css';

// Standalone administrator console. This is a separate app from the clinical
// charge-nurse prototype (served from admin.html, a distinct Vite entry point),
// so the administrator surface is never rendered inside a non-admin session
// (FR-3, NFR-8). There is still no authentication or backend here; the admin
// persona below is a labelled demo fixture, not a signed-in session, and every
// control inside AdminDashboard remains a disabled or preview-only affordance.
export default function AdminApp() {
  return (
    <div className="admin-app">
      <header className="admin-app-topbar">
        <a className="brand admin-app-brand" href="/admin.html">
          <span className="brand-mark"><Plus size={22} strokeWidth={3} /></span>
          CareBridge<span className="brand-period">.</span>
          <span className="admin-app-console-tag">Administrator console</span>
        </a>
        <div className="admin-app-topbar-right">
          <span className="demo-label"><span /> Separate admin app · synthetic data</span>
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
          <strong>Separate administrator console</strong>
          <p>
            This is a distinct app from the charge-nurse dashboard. It is a local visual prototype with no
            authentication: the administrator profile is a labelled demo fixture, and every management control
            is a disabled or preview-only affordance. Role-based access must be enforced by an authorized
            backend before any control becomes live (NFR-8). Hiding or separating a surface is not authorization.
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
