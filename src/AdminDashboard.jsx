import React, { useState } from 'react';
import {
  Activity, BookOpen, CheckCheck,
  ClipboardList, FileText, Plus, Search, Settings, Shield,
  Trash2, Upload, UserCog, Users, X, Eye, EyeOff,
  Database, RefreshCw, AlertCircle, Lock, Edit3
} from 'lucide-react';
import { incident, nurses, patients, updates, tasks } from './data.js';

// ── helpers ──────────────────────────────────────────────────────────────────
function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function SectionHeading({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="admin-section-heading">
      <div className="admin-section-title">
        <span className="admin-section-icon"><Icon size={16} /></span>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    Active:    'green',
    Inactive:  'neutral',
    Locked:    'red',
    'On break':'amber',
  };
  return <Badge tone={map[status] ?? 'neutral'}><span className="status-dot" />{status}</Badge>;
}

// ── synthetic admin state (not persisted) ────────────────────────────────────
const initialUsers = [
  { id: 'u1', name: 'Olivia Bennett',  email: 'o.bennett@westbrook.demo', role: 'Charge nurse',        status: 'Active',   lastSeen: '5m ago' },
  { id: 'u2', name: 'Sarah Chen',      email: 's.chen@westbrook.demo',    role: 'Nurse',               status: 'Active',   lastSeen: '2m ago' },
  { id: 'u3', name: 'James Wilson',    email: 'j.wilson@westbrook.demo',  role: 'Nurse',               status: 'Active',   lastSeen: '8m ago' },
  { id: 'u4', name: 'Maria Garcia',    email: 'm.garcia@westbrook.demo',  role: 'Nurse',               status: 'Active',   lastSeen: '12m ago' },
  { id: 'u5', name: 'David Park',      email: 'd.park@westbrook.demo',    role: 'Nurse',               status: 'Active',   lastSeen: '19m ago' },
  { id: 'u6', name: 'Emily Brooks',    email: 'e.brooks@westbrook.demo',  role: 'Nurse',               status: 'On break', lastSeen: '34m ago' },
  { id: 'u7', name: 'Alex Morgan',     email: 'a.morgan@westbrook.demo',  role: 'Nurse',               status: 'Active',   lastSeen: '1m ago' },
  { id: 'u8', name: 'Demo Admin (fixture)', email: 'admin@westbrook.demo', role: 'System administrator',status: 'Active',   lastSeen: '—' },
  { id: 'u9', name: 'Rachel Torres',   email: 'r.torres@westbrook.demo',  role: 'Nurse',               status: 'Inactive', lastSeen: '3d ago' },
];

const initialPolicies = [
  { id: 'POL-01', title: 'EHR Downtime Procedures',         category: 'Downtime',   updated: '2026-09-14', status: 'Active',   size: '142 KB' },
  { id: 'POL-02', title: 'Medication Safety During Outage', category: 'Medication', updated: '2026-08-22', status: 'Active',   size: '98 KB'  },
  { id: 'POL-03', title: 'Emergency Staffing Protocol',     category: 'Staffing',   updated: '2026-07-05', status: 'Active',   size: '76 KB'  },
  { id: 'POL-04', title: 'Patient Communication Guidelines',category: 'Patient',    updated: '2026-10-01', status: 'Active',   size: '54 KB'  },
  { id: 'POL-05', title: 'Supply Chain Contingency Plan',   category: 'Supplies',   updated: '2026-06-18', status: 'Inactive', size: '88 KB'  },
  { id: 'POL-06', title: 'Handoff Documentation Standards', category: 'Handoff',    updated: '2026-09-30', status: 'Active',   size: '63 KB'  },
];

const incidentTypes = [
  { id: 'IT-01', label: 'EHR outage',                   active: true  },
  { id: 'IT-02', label: 'Medication-system outage',     active: true  },
  { id: 'IT-03', label: 'Staffing disruption',          active: true  },
  { id: 'IT-04', label: 'Hospital communication outage',active: true  },
  { id: 'IT-05', label: 'Lab system outage',            active: false },
  { id: 'IT-06', label: 'Pharmacy system outage',       active: false },
];

// ── sub-panels ────────────────────────────────────────────────────────────────

function UserManagement() {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('All roles');
  const [notice, setNotice] = useState(null);

  const users = initialUsers;
  const roles = ['All roles', 'Nurse', 'Charge nurse', 'System administrator'];

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
      (roleFilter === 'All roles' || u.role === roleFilter)
    );
  });

  function toast(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }

  return (
    <div className="admin-panel">
      <SectionHeading
        icon={UserCog}
        title="User management"
        subtitle="Review nurse and charge nurse accounts. Detailed administrator permissions are not yet defined in the requirements."
        action={
          <button
            className="primary-button admin-add-btn"
            disabled
            title="Preview only — requires an authorized backend"
          >
            <Plus size={15} /> Add user · preview
          </button>
        }
      />

      <div className="notice admin-notice" style={{ marginBottom: 20 }}>
        <Shield size={14} />
        <span>
          Account controls are visual previews. Creating, deactivating, or removing users requires authenticated, role-based backend authorization (NFR-8). Hiding a control is not authorization.
        </span>
      </div>

      <div className="admin-toast-region" role="status" aria-live="polite">
        {notice && (
          <div className="admin-toast">
            <CheckCheck size={14} /> {notice}
          </div>
        )}
      </div>

      <div className="admin-toolbar">
        <label className="search-field admin-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users…"
            aria-label="Search users"
          />
          {search && (
            <button className="icon-button" onClick={() => setSearch('')} aria-label="Clear">
              <X size={13} />
            </button>
          )}
        </label>
        <label className="admin-filter-label">
          Role
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            {roles.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <span className="admin-count">{filtered.length} of {users.length} users</span>
      </div>

      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last seen</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((user) => (
              <tr key={user.id}>
                <td className="admin-name-cell">{user.name}</td>
                <td className="muted-cell">{user.email}</td>
                <td>
                  <Badge tone={user.role === 'System administrator' ? 'teal' : user.role === 'Charge nurse' ? 'amber' : 'neutral'}>
                    {user.role}
                  </Badge>
                </td>
                <td><StatusBadge status={user.status} /></td>
                <td className="muted-cell">{user.lastSeen}</td>
                <td>
                  <div className="admin-row-actions">
                    <button
                      className="icon-button"
                      title="Deactivate (preview only — requires authorized backend)"
                      onClick={() => toast('Account changes are previews. An authorized backend is required (NFR-8).')}
                      aria-label={`Deactivate ${user.name} (preview only)`}
                    >
                      <Lock size={14} />
                    </button>
                    <button
                      className="icon-button admin-delete-btn"
                      title="Remove user (preview only — requires authorized backend)"
                      onClick={() => toast('Account removal is a preview. An authorized backend is required (NFR-8).')}
                      aria-label={`Remove ${user.name} (preview only)`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state" style={{ padding: '32px 0' }}>
                    <Search size={22} />
                    <h3>No users match</h3>
                    <p>Try a different name or role filter.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-table-footer">
        <span>{filtered.length} of {users.length} account{users.length !== 1 ? 's' : ''}</span>
        <span><Shield size={12} /> Role-based access must be enforced by the backend (not yet connected)</span>
      </div>
    </div>
  );
}

function PatientDataManagement() {
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState(null);

  function toast(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  }

  const filtered = patients.filter((p) =>
    `${p.name} ${p.id} ${p.room}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="admin-panel">
      <SectionHeading
        icon={Database}
        title="Synthetic patient data"
        subtitle="Review the continuity data fixtures used during the demo. All records are fictional."
        action={
          <button className="primary-button admin-add-btn" disabled title="Preview only — requires an authorized backend">
            <Plus size={15} /> Add patient record · preview
          </button>
        }
      />

      <div className="admin-toast-region" role="status" aria-live="polite">
        {notice && (
          <div className="admin-toast">
            <CheckCheck size={14} /> {notice}
          </div>
        )}
      </div>

      <div className="notice admin-notice" style={{ marginBottom: 0 }}>
        <Shield size={14} />
        <span>
          Use synthetic data only; never introduce real patient information into fixtures, prompts, or screenshots (NFR-10). Record controls are visual previews and require an authorized backend (NFR-8). Hiding a control is not authorization.
        </span>
      </div>

      <div className="admin-toolbar" style={{ marginTop: 16 }}>
        <label className="search-field admin-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patients…"
            aria-label="Search patients"
          />
          {search && (
            <button className="icon-button" onClick={() => setSearch('')} aria-label="Clear">
              <X size={13} />
            </button>
          )}
        </label>
        <span className="admin-count">{filtered.length} of {patients.length} records</span>
      </div>

      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Patient ID</th>
              <th>Name</th>
              <th>Age</th>
              <th>Room</th>
              <th>Priority</th>
              <th>Assigned nurse</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const nurse = nurses.find((n) => n.id === p.nurse);
              return (
                <tr key={p.id}>
                  <td><span className="admin-id-tag">{p.id}</span></td>
                  <td className="admin-name-cell">{p.name}</td>
                  <td className="muted-cell">{p.age}</td>
                  <td className="muted-cell">{p.room}</td>
                  <td>
                    <Badge tone={p.priority === 'High' ? 'red' : p.priority === 'Moderate' ? 'amber' : 'green'}>
                      <span className="status-dot" />{p.priority}
                    </Badge>
                  </td>
                  <td className="muted-cell">{nurse?.name ?? '—'}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button
                        className="icon-button"
                        title="Edit record (preview only — requires authorized backend)"
                        onClick={() => toast('Patient data changes are previews. An authorized backend is required (NFR-8).')}
                        aria-label={`Edit ${p.name} (preview only)`}
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        className="icon-button admin-delete-btn"
                        title="Remove record (preview only — requires authorized backend)"
                        onClick={() => toast('Patient data changes are previews. An authorized backend is required (NFR-8).')}
                        aria-label={`Remove ${p.name} (preview only)`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state" style={{ padding: '32px 0' }}>
                    <Search size={22} />
                    <h3>No matching records</h3>
                    <p>Try a different search term.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-table-footer">
        <span>{filtered.length} synthetic patient record{filtered.length !== 1 ? 's' : ''}</span>
        <span><Shield size={12} /> Synthetic data only</span>
      </div>
    </div>
  );
}

function PolicyManagement() {
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState(null);

  const policies = initialPolicies;

  function toast(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }

  const filtered = policies.filter((p) =>
    `${p.title} ${p.category}`.toLowerCase().includes(search.toLowerCase())
  );

  const activeCount = policies.filter((p) => p.status === 'Active').length;

  return (
    <div className="admin-panel">
      <SectionHeading
        icon={BookOpen}
        title="Facility policy documents"
        subtitle="Documents ingested into the Bedrock Knowledge Base. Update policies here without changing application code (NFR-26)."
        action={
          <button className="primary-button admin-add-btn" disabled title="Preview only — connect an S3 bucket and authorized backend">
            <Upload size={15} /> Upload document · preview
          </button>
        }
      />

      <div className="admin-toast-region" role="status" aria-live="polite">
        {notice && (
          <div className="admin-toast">
            <CheckCheck size={14} /> {notice}
          </div>
        )}
      </div>

      <div className="admin-stat-row">
        <div className="admin-stat-chip"><BookOpen size={13} />{policies.length} documents</div>
        <div className="admin-stat-chip green-chip"><CheckCheck size={13} />{activeCount} active in Knowledge Base</div>
        <div className="admin-stat-chip amber-chip"><AlertCircle size={13} />{policies.length - activeCount} inactive</div>
      </div>

      <div className="notice admin-notice" style={{ marginBottom: 0 }}>
        <Shield size={14} />
        <span>
          Policy answers cite the documents stored here. Keep sources accurate; the assistant will indicate when no relevant policy is found (FR-29).
        </span>
      </div>

      <div className="admin-toolbar" style={{ marginTop: 16 }}>
        <label className="search-field admin-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search policies…"
            aria-label="Search policies"
          />
          {search && (
            <button className="icon-button" onClick={() => setSearch('')} aria-label="Clear">
              <X size={13} />
            </button>
          )}
        </label>
        <span className="admin-count">{filtered.length} of {policies.length} documents</span>
      </div>

      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Document</th>
              <th>Category</th>
              <th>Last updated</th>
              <th>Size</th>
              <th>Status</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((pol) => (
              <tr key={pol.id}>
                <td>
                  <div className="admin-doc-cell">
                    <FileText size={15} />
                    <span className="admin-name-cell">{pol.title}</span>
                  </div>
                  <span className="admin-id-tag" style={{ marginTop: 4, display: 'inline-block' }}>{pol.id}</span>
                </td>
                <td><Badge>{pol.category}</Badge></td>
                <td className="muted-cell">{pol.updated}</td>
                <td className="muted-cell">{pol.size}</td>
                <td><StatusBadge status={pol.status} /></td>
                <td>
                  <div className="admin-row-actions">
                    <button
                      className="icon-button"
                      title={pol.status === 'Active' ? 'Deactivate from Knowledge Base (preview only)' : 'Activate in Knowledge Base (preview only)'}
                      onClick={() => toast('Knowledge Base changes are previews. Connect Bedrock and an authorized backend to enable (NFR-26).')}
                      aria-label={pol.status === 'Active' ? `Deactivate ${pol.title} (preview only)` : `Activate ${pol.title} (preview only)`}
                    >
                      {pol.status === 'Active' ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      className="icon-button"
                      title="Re-sync to Knowledge Base (preview only)"
                      onClick={() => toast('Knowledge Base changes are previews. Connect Bedrock and an authorized backend to enable (NFR-26).')}
                      aria-label={`Sync ${pol.title} (preview only)`}
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      className="icon-button admin-delete-btn"
                      title="Delete document (preview only)"
                      onClick={() => toast('Knowledge Base changes are previews. Connect Bedrock and an authorized backend to enable (NFR-26).')}
                      aria-label={`Delete ${pol.title} (preview only)`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state" style={{ padding: '32px 0' }}>
                    <BookOpen size={22} />
                    <h3>No matching documents</h3>
                    <p>Try a different search term.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-table-footer">
        <span>{activeCount} document{activeCount !== 1 ? 's' : ''} active in Knowledge Base</span>
        <span><RefreshCw size={12} /> Last sync: demo prototype</span>
      </div>
    </div>
  );
}

function IncidentConfig() {
  const [newLabel, setNewLabel] = useState('');
  const [notice, setNotice] = useState(null);

  const types = incidentTypes;

  function toast(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }

  return (
    <div className="admin-panel">
      <SectionHeading
        icon={Activity}
        title="Incident configuration"
        subtitle="Crisis types available to charge nurses when activating an incident (FR-6)."
      />

      <div className="notice admin-notice" style={{ marginBottom: 20 }}>
        <Shield size={14} />
        <span>
          Incident type configuration is a visual preview. Changes require an authorized backend with role-based access (NFR-8).
        </span>
      </div>

      <div className="admin-toast-region" role="status" aria-live="polite">
        {notice && (
          <div className="admin-toast">
            <CheckCheck size={14} /> {notice}
          </div>
        )}
      </div>

      <div className="admin-incident-grid">
        {types.map((t) => (
          <div key={t.id} className={`admin-incident-chip ${t.active ? 'active' : 'inactive'}`}>
            <Activity size={13} />
            <span>{t.label}</span>
            <button
              className="icon-button admin-chip-toggle"
              onClick={() => toast('Incident type changes are previews. An authorized backend is required (NFR-8).')}
              aria-label={t.active ? `Disable ${t.label} (preview only)` : `Enable ${t.label} (preview only)`}
              title={t.active ? 'Disable (preview only)' : 'Enable (preview only)'}
            >
              {t.active ? <CheckCheck size={13} /> : <Plus size={13} />}
            </button>
          </div>
        ))}
      </div>

      <div className="admin-add-type-row">
        <input
          className="admin-input"
          placeholder="New incident type label… (preview)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          aria-label="New incident type (preview only)"
        />
        <button
          className="primary-button"
          disabled
          title="Preview only — requires an authorized backend"
        >
          <Plus size={15} /> Add type · preview
        </button>
      </div>

      <div className="admin-current-incident">
        <div className="admin-section-title" style={{ marginBottom: 14 }}>
          <span className="admin-section-icon"><AlertCircle size={16} /></span>
          <div>
            <h2>Current incident</h2>
            <p>Live status pulled from synthetic incident fixture.</p>
          </div>
        </div>
        <div className="admin-incident-status-card">
          <div className="admin-incident-row">
            <strong>Incident ID</strong><span>{incident.id}</span>
          </div>
          <div className="admin-incident-row">
            <strong>Type</strong><span>{incident.type}</span>
          </div>
          <div className="admin-incident-row">
            <strong>Unit</strong><span>{incident.unit}</span>
          </div>
          <div className="admin-incident-row">
            <strong>Status</strong>
            <span><Badge tone="amber"><span className="status-dot" />Active</Badge></span>
          </div>
          <div className="admin-incident-row">
            <strong>Started</strong><span>{new Date(incident.startedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' })} Pacific</span>
          </div>
        </div>
        <div className="notice" style={{ marginTop: 16 }}>
          Deactivation controls require the authorized charge nurse role (FR-8). This panel shows read-only status only.
        </div>
      </div>
    </div>
  );
}

function SystemOverview() {
  const stats = [
    { label: 'Total users',         value: initialUsers.length,                                           icon: Users,       tone: '' },
    { label: 'Active users',        value: initialUsers.filter((u) => u.status === 'Active').length,      icon: CheckCheck,  tone: 'green' },
    { label: 'Policy documents',    value: initialPolicies.length,                                        icon: BookOpen,    tone: '' },
    { label: 'Synthetic patients',  value: patients.length,                                               icon: Database,    tone: '' },
    { label: 'Open tasks',          value: tasks.length,                                                  icon: ClipboardList, tone: 'amber' },
    { label: 'Nurse updates',       value: updates.length,                                                icon: FileText,    tone: '' },
  ];

  return (
    <div className="admin-panel">
      <SectionHeading
        icon={Settings}
        title="System overview"
        subtitle="A read-only snapshot of the demo environment. No AWS services are connected; the services below are proposals, not final choices."
      />

      <div className="admin-overview-grid">
        {stats.map((s) => (
          <div key={s.label} className={`admin-overview-card ${s.tone}`}>
            <span className="admin-overview-icon"><s.icon size={18} /></span>
            <span className="admin-overview-value">{s.value}</span>
            <span className="admin-overview-label">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="admin-service-table">
        <h3>Proposed AWS service status</h3>
        <p className="admin-service-note">Only Amazon Bedrock, a Bedrock Knowledge Base, and Bedrock Guardrails are specified in the requirements. The rest are proposals to validate during implementation.</p>
        <table className="admin-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Service</th>
              <th>Purpose</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {[
              { svc: 'Amazon Cognito',              purpose: 'Authentication and role-based access', status: 'Not connected' },
              { svc: 'Amazon DynamoDB',             purpose: 'Patient, task, and update storage',    status: 'Not connected' },
              { svc: 'Amazon Bedrock',              purpose: 'AI summarization and prioritization',  status: 'Not connected' },
              { svc: 'Bedrock Knowledge Base',      purpose: 'Policy retrieval with citations',      status: 'Not connected' },
              { svc: 'Bedrock Guardrails',          purpose: 'Safe AI response filtering',           status: 'Not connected' },
              { svc: 'Amazon S3',                   purpose: 'Policy document storage',              status: 'Not connected' },
              { svc: 'Amazon API Gateway + Lambda', purpose: 'Backend API and logic',                status: 'Not connected' },
            ].map((row) => (
              <tr key={row.svc}>
                <td className="admin-name-cell">{row.svc}</td>
                <td className="muted-cell">{row.purpose}</td>
                <td><Badge tone="neutral"><span className="status-dot" />{row.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="notice wide-notice" style={{ marginTop: 20 }}>
        <Shield size={15} />
        <span>
          This is a local visual prototype. No credentials, tokens, or patient information should be committed to source control.
          Implement AWS services following least-privilege permissions and encryption in transit and at rest (NFR-9).
        </span>
      </div>
    </div>
  );
}

// ── main export ───────────────────────────────────────────────────────────────
const adminNav = [
  { label: 'Overview',    icon: Settings    },
  { label: 'Users',       icon: UserCog     },
  { label: 'Patients',    icon: Database    },
  { label: 'Policies',    icon: BookOpen    },
  { label: 'Incidents',   icon: Activity    },
];

export default function AdminDashboard() {
  const [section, setSection] = useState('Overview');

  return (
    <div className="admin-shell">
      {/* Admin sub-nav */}
      <nav className="admin-subnav" aria-label="Admin sections">
        {adminNav.map(({ label, icon: Icon }) => (
          <button
            key={label}
            className={`admin-nav-item ${section === label ? 'active' : ''}`}
            onClick={() => setSection(label)}
            aria-current={section === label ? 'page' : undefined}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>

      {/* Section content */}
      <div className="admin-content">
        {section === 'Overview'  && <SystemOverview />}
        {section === 'Users'     && <UserManagement />}
        {section === 'Patients'  && <PatientDataManagement />}
        {section === 'Policies'  && <PolicyManagement />}
        {section === 'Incidents' && <IncidentConfig />}
      </div>
    </div>
  );
}
