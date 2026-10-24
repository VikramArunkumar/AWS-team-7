import React, { useState } from 'react';
import {
  Activity, ArrowRight, BookOpen, CheckCheck, ChevronRight,
  ClipboardList, FileText, Plus, Search, Settings, Shield,
  Trash2, TriangleAlert, Upload, UserCog, Users, X, Eye, EyeOff,
  Database, RefreshCw, AlertCircle, Lock, Unlock, Edit3
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
  { id: 'u8', name: 'Admin Account',   email: 'admin@westbrook.demo',     role: 'System administrator',status: 'Active',   lastSeen: 'Now' },
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
  const [users, setUsers] = useState(initialUsers);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('All roles');
  const [modal, setModal] = useState(null); // { type: 'add'|'edit'|'confirm', user? }
  const [formData, setFormData] = useState({ name: '', email: '', role: 'Nurse' });
  const [notice, setNotice] = useState(null);

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
    setTimeout(() => setNotice(null), 3000);
  }

  function handleAdd() {
    if (!formData.name.trim() || !formData.email.trim()) return;
    setUsers((prev) => [
      ...prev,
      {
        id: `u${Date.now()}`,
        name: formData.name.trim(),
        email: formData.email.trim(),
        role: formData.role,
        status: 'Active',
        lastSeen: 'Never',
      },
    ]);
    setModal(null);
    setFormData({ name: '', email: '', role: 'Nurse' });
    toast(`${formData.name} added successfully.`);
  }

  function handleToggleStatus(id) {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === id
          ? { ...u, status: u.status === 'Active' ? 'Inactive' : 'Active' }
          : u
      )
    );
  }

  function handleDelete(id) {
    const user = users.find((u) => u.id === id);
    setUsers((prev) => prev.filter((u) => u.id !== id));
    setModal(null);
    toast(`${user.name} removed.`);
  }

  return (
    <div className="admin-panel">
      <SectionHeading
        icon={UserCog}
        title="User management"
        subtitle="Manage nurse and charge nurse accounts. Role changes take effect on next sign-in."
        action={
          <button
            className="primary-button admin-add-btn"
            onClick={() => { setFormData({ name: '', email: '', role: 'Nurse' }); setModal({ type: 'add' }); }}
          >
            <Plus size={15} /> Add user
          </button>
        }
      />

      {notice && (
        <div className="admin-toast">
          <CheckCheck size={14} /> {notice}
        </div>
      )}

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
                      title={user.status === 'Active' ? 'Deactivate' : 'Activate'}
                      onClick={() => handleToggleStatus(user.id)}
                      aria-label={user.status === 'Active' ? `Deactivate ${user.name}` : `Activate ${user.name}`}
                    >
                      {user.status === 'Active' ? <Lock size={14} /> : <Unlock size={14} />}
                    </button>
                    <button
                      className="icon-button admin-delete-btn"
                      title="Remove user"
                      onClick={() => setModal({ type: 'confirm', user })}
                      aria-label={`Remove ${user.name}`}
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

      {/* Add user modal */}
      {modal?.type === 'add' && (
        <div className="admin-modal-backdrop" onClick={() => setModal(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add user">
            <div className="admin-modal-header">
              <h3>Add user</h3>
              <button className="icon-button" onClick={() => setModal(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <p className="admin-modal-sub">New accounts use synthetic credentials only. No real patient data.</p>
            <label className="admin-form-label">Full name
              <input
                className="admin-input"
                value={formData.name}
                onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Jordan Lee"
              />
            </label>
            <label className="admin-form-label">Email (demo address)
              <input
                className="admin-input"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((f) => ({ ...f, email: e.target.value }))}
                placeholder="e.g. j.lee@westbrook.demo"
              />
            </label>
            <label className="admin-form-label">Role
              <select
                className="admin-input"
                value={formData.role}
                onChange={(e) => setFormData((f) => ({ ...f, role: e.target.value }))}
              >
                <option>Nurse</option>
                <option>Charge nurse</option>
                <option>System administrator</option>
              </select>
            </label>
            <div className="admin-modal-footer">
              <button className="secondary-button" onClick={() => setModal(null)}>Cancel</button>
              <button
                className="primary-button"
                onClick={handleAdd}
                disabled={!formData.name.trim() || !formData.email.trim()}
              >
                Add user
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete modal */}
      {modal?.type === 'confirm' && (
        <div className="admin-modal-backdrop" onClick={() => setModal(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Confirm removal">
            <div className="admin-modal-header">
              <h3>Remove user?</h3>
              <button className="icon-button" onClick={() => setModal(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <p className="admin-modal-sub">
              <strong>{modal.user.name}</strong> will be removed from the system. This action cannot be undone in this prototype.
            </p>
            <div className="admin-modal-footer">
              <button className="secondary-button" onClick={() => setModal(null)}>Cancel</button>
              <button className="primary-button admin-danger-btn" onClick={() => handleDelete(modal.user.id)}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
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
        subtitle="Manage the continuity data fixtures used during the demo. All records are fictional."
        action={
          <button className="primary-button admin-add-btn" onClick={() => toast('Patient creation is a placeholder in this prototype.')}>
            <Plus size={15} /> Add patient record
          </button>
        }
      />

      {notice && (
        <div className="admin-toast">
          <CheckCheck size={14} /> {notice}
        </div>
      )}

      <div className="notice admin-notice" style={{ marginBottom: 0 }}>
        <Shield size={14} />
        <span>
          Use synthetic data only. Never introduce real patient information into fixtures, prompts, or screenshots (NFR-10).
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
                        title="Edit record (preview only)"
                        onClick={() => toast(`Edit for ${p.name} is a placeholder in this prototype.`)}
                        aria-label={`Edit ${p.name}`}
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        className="icon-button admin-delete-btn"
                        title="Remove record (preview only)"
                        onClick={() => toast(`Delete is a placeholder in this prototype.`)}
                        aria-label={`Remove ${p.name}`}
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
  const [policies, setPolicies] = useState(initialPolicies);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState(null);

  function toast(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }

  function toggleStatus(id) {
    setPolicies((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status: p.status === 'Active' ? 'Inactive' : 'Active' } : p
      )
    );
    const pol = policies.find((p) => p.id === id);
    toast(`"${pol.title}" ${pol.status === 'Active' ? 'deactivated' : 'activated'}.`);
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
          <button className="primary-button admin-add-btn" onClick={() => toast('Document upload is a placeholder. Connect an S3 bucket to enable ingestion.')}>
            <Upload size={15} /> Upload document
          </button>
        }
      />

      {notice && (
        <div className="admin-toast">
          <CheckCheck size={14} /> {notice}
        </div>
      )}

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
                      title={pol.status === 'Active' ? 'Deactivate from Knowledge Base' : 'Activate in Knowledge Base'}
                      onClick={() => toggleStatus(pol.id)}
                      aria-label={pol.status === 'Active' ? `Deactivate ${pol.title}` : `Activate ${pol.title}`}
                    >
                      {pol.status === 'Active' ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      className="icon-button"
                      title="Re-sync to Knowledge Base (preview)"
                      onClick={() => toast(`Re-sync for "${pol.title}" is a placeholder. Connect Bedrock to enable.`)}
                      aria-label={`Sync ${pol.title}`}
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      className="icon-button admin-delete-btn"
                      title="Delete document (preview)"
                      onClick={() => toast(`Delete is a placeholder in this prototype.`)}
                      aria-label={`Delete ${pol.title}`}
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
  const [types, setTypes] = useState(incidentTypes);
  const [newLabel, setNewLabel] = useState('');
  const [notice, setNotice] = useState(null);

  function toast(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  }

  function toggleType(id) {
    setTypes((prev) =>
      prev.map((t) => (t.id === id ? { ...t, active: !t.active } : t))
    );
  }

  function addType() {
    if (!newLabel.trim()) return;
    setTypes((prev) => [...prev, { id: `IT-${Date.now()}`, label: newLabel.trim(), active: true }]);
    toast(`"${newLabel.trim()}" added to incident types.`);
    setNewLabel('');
  }

  return (
    <div className="admin-panel">
      <SectionHeading
        icon={Activity}
        title="Incident configuration"
        subtitle="Define the crisis types available to charge nurses when activating an incident (FR-6)."
      />

      {notice && (
        <div className="admin-toast">
          <CheckCheck size={14} /> {notice}
        </div>
      )}

      <div className="admin-incident-grid">
        {types.map((t) => (
          <div key={t.id} className={`admin-incident-chip ${t.active ? 'active' : 'inactive'}`}>
            <Activity size={13} />
            <span>{t.label}</span>
            <button
              className="icon-button admin-chip-toggle"
              onClick={() => toggleType(t.id)}
              aria-label={t.active ? `Disable ${t.label}` : `Enable ${t.label}`}
              title={t.active ? 'Disable' : 'Enable'}
            >
              {t.active ? <CheckCheck size={13} /> : <Plus size={13} />}
            </button>
          </div>
        ))}
      </div>

      <div className="admin-add-type-row">
        <input
          className="admin-input"
          placeholder="New incident type label…"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addType()}
          aria-label="New incident type"
        />
        <button
          className="primary-button"
          onClick={addType}
          disabled={!newLabel.trim()}
        >
          <Plus size={15} /> Add type
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
        subtitle="A read-only snapshot of the demo environment. No real AWS services are connected."
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
