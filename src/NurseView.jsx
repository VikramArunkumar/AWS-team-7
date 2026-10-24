// Nurse workspace, backed by the CareBridge API.
//
// Reads GET /incidents/{id}/workspace (only this nurse's patients, tasks, and
// own updates), saves updates with POST .../updates, corrects them with
// PATCH .../updates/{id}, and reports task status with PATCH .../tasks/{id}.
// The API enforces every permission; this screen only reflects what it allows.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, ArrowUpRight, CheckCheck, ChevronRight, CircleHelp, ClipboardCheck, ClipboardList, Clock3, FileText, HeartPulse, LayoutDashboard, LoaderCircle, LogOut, Menu, Plus, RefreshCw, Send, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { Badge, Priority } from './ui.jsx';
import { updateCategories, minutesSince, formatTime } from './data.js';
import { initialsFor } from './auth/AuthGate.jsx';
import { SessionExpiredError } from './api/client.js';
import {
  TASK_ACTIONS, processingLabel, isTaskOverdue, isPatientUnverified, sortTasks, upsertById,
  newRequestId, listOrNotRecorded, saveErrorMessage,
} from './nurse/workspace.js';

const REFRESH_MS = 60_000;
const EMPTY_FORM = { patient: '', category: updateCategories[0], text: '', urgent: false };
const statusTone = (status) => status === 'Completed' ? 'green' : (status === 'Delayed' || status === 'Unable to complete') ? 'red' : status === 'Unconfirmed' ? 'amber' : 'teal';

export function NurseView({ me, onSignOut, api, incidentId, onSessionExpired }) {
  const myInitials = initialsFor(me.displayName);
  const firstName = String(me.displayName).split(/\s+/)[0] || me.displayName;
  const [now, setNow] = useState(Date.now());
  const [page, setPage] = useState('My shift');
  const [modal, setModal] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);

  // Server data. `data` stays on screen if a background refresh fails.
  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [loadError, setLoadError] = useState(null);
  const [refreshFailed, setRefreshFailed] = useState(false);

  // Per-task save state: { [taskId]: { busy, error, savedAt } }
  const [taskSave, setTaskSave] = useState({});

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  // Reused when retrying the same submission so a retry cannot create a duplicate.
  const requestId = useRef(null);
  const [announcement, setAnnouncement] = useState('');
  const dialog = useRef(null);

  const handleError = useCallback((err) => {
    if (err instanceof SessionExpiredError || err?.status === 401) {
      void onSessionExpired?.();
      return true;
    }
    return false;
  }, [onSessionExpired]);

  const load = useCallback(async ({ background = false } = {}) => {
    if (!background) setLoadState((state) => (state === 'ready' ? state : 'loading'));
    try {
      const next = await api.getWorkspace(incidentId);
      setData(next);
      setLoadState('ready');
      setLoadError(null);
      setRefreshFailed(false);
    } catch (err) {
      if (handleError(err)) return;
      if (background) { setRefreshFailed(true); return; }
      setLoadError(err);
      setLoadState((state) => (state === 'ready' ? state : 'error'));
      setRefreshFailed(true);
    }
  }, [api, incidentId, handleError]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    const refresh = setInterval(() => { void load({ background: true }); }, REFRESH_MS);
    return () => { clearInterval(clock); clearInterval(refresh); };
  }, [load]);
  useEffect(() => {
    if (modal) { dialog.current?.showModal(); document.body.style.overflow = 'hidden'; }
    else { dialog.current?.close(); document.body.style.overflow = ''; }
    return () => { document.body.style.overflow = ''; };
  }, [modal]);

  const go = (next) => { setPage(next); setMobileMenu(false); };

  if (loadState !== 'ready' || !data) {
    const notFound = loadError?.status === 404;
    return <main className="auth-screen">
      <section className="panel auth-card" aria-busy={loadState === 'loading'} aria-live="polite">
        <div className="brand auth-brand"><span className="brand-mark"><Plus size={24} strokeWidth={3} /></span>CareBridge<span className="brand-period">.</span></div>
        {loadState === 'loading'
          ? <h1><LoaderCircle className="auth-spinner" size={20} aria-hidden="true" />Loading your shift</h1>
          : <>
            <h1>{notFound ? 'No active incident found' : "Your shift couldn't load"}</h1>
            <div className="notice amber-notice auth-notice" role="alert"><TriangleAlert size={16} aria-hidden="true" /><span>{notFound ? `CareBridge has no incident ${incidentId}. Ask your charge nurse which incident is active.` : (loadError?.message ?? 'Try again in a moment.')}</span></div>
            <div className="auth-actions">
              <button className="primary-button" onClick={() => load()}><RefreshCw size={15} aria-hidden="true" /> Try again</button>
              <button className="secondary-button" onClick={onSignOut}><LogOut size={15} aria-hidden="true" /> Sign out</button>
            </div>
          </>}
      </section>
    </main>;
  }

  const { incident } = data;
  const freshness = data.meta?.verificationFreshnessMinutes ?? 60;
  const incidentActive = incident.status === 'active';
  const myPatients = data.patients.filter((patient) => patient.assignedToMe);
  const patientFor = (id) => data.patients.find((patient) => patient.id === id);
  const patientLabel = (id) => { const p = patientFor(id); return p ? `Room ${p.room} · ${p.name.split(' ')[0]}` : id; };
  const myTasks = data.tasks;
  const myUpdates = data.updates;
  const openTasks = myTasks.filter((task) => task.status !== 'Completed');
  const overdueTasks = myTasks.filter((task) => isTaskOverdue(task, now));
  const highPriority = myPatients.filter((patient) => patient.priority === 'High');
  const elapsed = minutesSince(incident.startedAt, incident.endedAt ? Date.parse(incident.endedAt) : now);
  const sortedTasks = sortTasks(myTasks);

  const setTaskStatus = async (task, status) => {
    setTaskSave((prev) => ({ ...prev, [task.id]: { busy: true } }));
    try {
      const saved = await api.setTaskStatus(incidentId, task.id, status);
      setData((prev) => ({ ...prev, tasks: upsertById(prev.tasks, saved) }));
      setTaskSave((prev) => ({ ...prev, [task.id]: { savedAt: new Date().toISOString() } }));
      setAnnouncement(`${task.description} saved as ${status}.`);
    } catch (err) {
      if (handleError(err)) return;
      const message = `Not saved. ${err?.message ?? 'Try again.'}`;
      setTaskSave((prev) => ({ ...prev, [task.id]: { error: message } }));
      setAnnouncement(`${task.description}: ${message}`);
    }
  };

  const changeForm = (patch) => {
    // New content is a new submission, so it gets a new request id.
    requestId.current = null;
    setSubmitError(null);
    setForm((prev) => ({ ...prev, ...patch }));
  };
  const resetForm = () => { setEditingId(null); setForm(EMPTY_FORM); setSubmitError(null); requestId.current = null; };

  const submitUpdate = async (event) => {
    event.preventDefault();
    if (submitting || !form.patient || !form.text.trim() || !incidentActive) return;
    setSubmitting(true);
    setSubmitError(null);
    const correcting = Boolean(editingId);
    try {
      let saved;
      if (correcting) {
        saved = await api.correctUpdate(incidentId, editingId, { text: form.text.trim(), category: form.category, urgent: form.urgent });
      } else {
        requestId.current ??= newRequestId();
        saved = await api.createUpdate(incidentId, { ...form, text: form.text.trim(), clientRequestId: requestId.current });
      }
      setData((prev) => ({ ...prev, updates: upsertById(prev.updates, saved) }));
      resetForm();
      setAnnouncement(correcting ? 'Your correction was saved.' : 'Your update was saved.');
      setModal({ type: 'saved', item: saved, correcting });
    } catch (err) {
      if (handleError(err)) return;
      setSubmitError(saveErrorMessage(err, { correcting }));
    } finally {
      setSubmitting(false);
    }
  };

  const startCorrection = (update) => {
    setEditingId(update.id);
    setForm({ patient: update.patient, category: update.category, text: update.text, urgent: Boolean(update.urgent) });
    setSubmitError(null);
    requestId.current = null;
    setModal(null);
    go('Submit update');
  };

  const navigation = [
    { label: 'My shift', icon: LayoutDashboard },
    { label: 'My patients', icon: HeartPulse, count: myPatients.length },
    { label: 'My tasks', icon: ClipboardList, count: openTasks.length },
    { label: 'Submit update', icon: Send },
  ];

  const taskCard = (task) => {
    const patient = patientFor(task.patient);
    const overdue = isTaskOverdue(task, now);
    const save = taskSave[task.id] ?? {};
    return <div className={`panel nurse-task ${task.status === 'Completed' ? 'done' : ''}`} key={task.id}>
      <div className="nurse-task-head"><Priority value={task.priority} /><Badge tone={statusTone(task.status)}>{task.status}</Badge></div>
      <h3>{task.description}</h3>
      <p className="muted">{patient ? `Room ${patient.room} · ${patient.name}` : task.patient} · {task.id}</p>
      <div className="nurse-task-meta"><Clock3 size={13} /><strong className={overdue ? 'red-text' : ''}>{!task.dueAt ? 'No due time' : overdue ? `${minutesSince(task.dueAt, now)}m overdue` : `Due ${formatTime(task.dueAt)} Pacific`}</strong>{task.creator && <span className="muted">Assigned by {task.creator}</span>}</div>
      <div className="nurse-task-actions">
        {task.status === 'Unconfirmed' && <button className="secondary-button" disabled={save.busy} onClick={() => setTaskStatus(task, 'In progress')}><ClipboardCheck size={15} /> Acknowledge</button>}
        {TASK_ACTIONS.map(({ status, label, primary }) => <button key={status} className={primary ? 'primary-button' : 'secondary-button'} disabled={save.busy || task.status === status} onClick={() => setTaskStatus(task, status)}>{primary && <CheckCheck size={15} />} {label}</button>)}
        {['Completed', 'Delayed', 'Unable to complete'].includes(task.status) && <button className="text-button" disabled={save.busy} onClick={() => setTaskStatus(task, 'In progress')}>Back to in progress</button>}
      </div>
      {save.busy && <p className="task-confirm"><LoaderCircle size={13} className="auth-spinner" /> Saving…</p>}
      {save.savedAt && <p className="task-confirm"><CheckCheck size={13} /> Saved as “{task.status}” at {formatTime(save.savedAt)} Pacific</p>}
      {save.error && <p className="task-confirm red-text" role="alert"><TriangleAlert size={13} /> {save.error}</p>}
    </div>;
  };

  function renderModal() {
    if (!modal) return null;
    const item = modal.item;
    if (modal.type === 'patient') {
      const patientTasks = myTasks.filter((task) => task.patient === item.id);
      const patientUpdates = myUpdates.filter((update) => update.patient === item.id);
      return <><span className="eyebrow">SYNTHETIC PATIENT · ROOM {item.room}</span><h2>{item.name}</h2><p className="modal-lead">{item.id}{item.age ? ` · ${item.age} years` : ''} · {item.assignedToMe ? 'In your care' : 'Linked to one of your tasks'}</p><Priority value={item.priority} />
        <div className="detail-block"><h3>Continuity profile</h3><dl className="detail-grid"><dt>Allergies</dt><dd>{listOrNotRecorded(item.allergies)}</dd><dt>Critical medications</dt><dd>{listOrNotRecorded(item.medications)}</dd><dt>Relevant conditions</dt><dd>{listOrNotRecorded(item.conditions)}</dd><dt>Care priorities</dt><dd>{item.carePriorities || 'Not recorded'}</dd><dt>Risk indicators</dt><dd>{Array.isArray(item.riskIndicators) && item.riskIndicators.length ? item.riskIndicators.join(', ') : 'None recorded'}</dd></dl><p className="muted">Synthetic continuity fields. Verify against source records before acting.</p></div>
        <div className="detail-block"><h3>Current coordination concern</h3><p>{item.detail || item.concern || 'None recorded.'}</p></div>
        <div className="detail-block"><h3>Information freshness</h3><p>{item.verifiedAt ? `Last verified at ${formatTime(item.verifiedAt)} Pacific (${minutesSince(item.verifiedAt, now)} minutes ago).` : 'This continuity profile has not been verified.'}</p><p className="muted">CareBridge flags information after {freshness} minutes without verification. Demo setting, not a facility policy.</p></div>
        <h3>Your tasks for this patient</h3>{patientTasks.map((task) => <div className="detail-list-item" key={task.id}><ClipboardList size={17} /><span>{task.description}<small>{task.status}{task.dueAt ? ` · Due ${formatTime(task.dueAt)} Pacific` : ''}</small></span></div>)}{!patientTasks.length && <p className="muted">No tasks for this patient.</p>}
        <h3 style={{ marginTop: 23 }}>Your updates for this patient</h3>{patientUpdates.length > 0 ? patientUpdates.map((update) => <button className="detail-list-item" key={update.id} onClick={() => setModal({ type: 'saved', item: update })}><FileText size={16} /><span>{update.text}<small>{formatTime(update.createdAt)} Pacific{update.urgent ? ' · Urgent' : ''}</small></span><ChevronRight size={16} /></button>) : <p className="muted">No updates from you for this patient yet.</p>}
        {item.assignedToMe && incidentActive && <button className="secondary-button modal-footer-button" onClick={() => { resetForm(); setForm({ ...EMPTY_FORM, patient: item.id }); setModal(null); go('Submit update'); }}><Send size={15} /> Submit an update for {item.name.split(' ')[0]}</button>}</>;
    }
    if (modal.type === 'saved') {
      const history = item.editHistory ?? [];
      const patient = patientFor(item.patient);
      return <><span className="eyebrow">{modal.correcting ? 'CORRECTION SAVED' : modal.correcting === false ? 'UPDATE SAVED' : 'YOUR UPDATE'} · {item.id}</span><h2>{modal.correcting ? 'Your correction was saved.' : modal.correcting === false ? 'Your update was saved.' : 'Your update'}</h2><p className="modal-lead">{patient ? `${patient.name} · Room ${patient.room}` : item.patient} · {formatTime(item.createdAt)} Pacific · by {me.displayName}</p>{item.urgent && <Badge tone="red">Urgent</Badge>}<div className="source-quote">{item.text}</div><p className="muted">Category: {item.category}{item.editedAt ? ` · Corrected ${formatTime(item.editedAt)} Pacific` : ''}</p><p className="muted"><ShieldCheck size={12} /> {processingLabel(item.processing)}</p>
        {history.length > 0 && <div className="detail-block"><h3>Correction history <span className="count">{history.length}</span></h3>{history.map((version, index) => <div className="detail-list-item" key={index}><FileText size={16} /><span>{version.text}<small>{version.category ? `${version.category} · ` : ''}{version.urgent ? 'Urgent · ' : ''}replaced {formatTime(version.replacedAt)} Pacific</small></span></div>)}<p className="muted">Every earlier version is kept. The original is never overwritten.</p></div>}
        {incidentActive && <button className="secondary-button modal-footer-button" onClick={() => startCorrection(item)}><FileText size={15} /> Correct this update</button>}
        <div className="notice">Saved to CareBridge with your name and the time. The update is stored before any AI processing, so it stays available even if AI processing fails.</div></>;
    }
    return <><span className="eyebrow">ABOUT THIS VIEW</span><h2>The nurse's view.</h2><p className="modal-lead">Submit updates and act on the tasks assigned to you.</p><p>Updates, corrections, and task status changes are saved to CareBridge and shared with your charge nurse. You only see your own patients, tasks, and updates. All people and patients are synthetic.</p></>;
  }

  const mainContent = <>
    {(page === 'My shift' || page === 'My patients') && <div className="stats-grid">
      <button className="stat-card" onClick={() => go('My patients')}><span className="stat-label">My patients <HeartPulse size={18} /></span><div className="stat-value">{myPatients.length}<span>in your care</span></div><span className="stat-description">View continuity info <ArrowRight size={13} /></span></button>
      <button className="stat-card urgent-stat" onClick={() => go('My tasks')}><span className="stat-label">Open tasks <ClipboardList size={18} /></span><div className="stat-value">{openTasks.length}<span><span className="amber-text">{overdueTasks.length} overdue</span></span></div><span className="stat-description red-text">Act on your tasks <ArrowRight size={13} /></span></button>
      <button className="stat-card" onClick={() => go('My patients')}><span className="stat-label">High priority <TriangleAlert size={18} /></span><div className="stat-value">{highPriority.length}<span>need attention</span></div><span className="stat-description">Review concerns <ArrowUpRight size={13} /></span></button>
      <button className="stat-card" onClick={() => go('Submit update')}><span className="stat-label">Submit update <Send size={18} /></span><div className="stat-value">{myUpdates.length}<span>from you</span></div><span className="stat-description">Add a new update <ArrowUpRight size={13} /></span></button>
    </div>}

    {page === 'My shift' && (overdueTasks.length > 0 || highPriority.length > 0) && <div className="attention-banner"><TriangleAlert size={18} /><div className="attention-text"><strong>Needs your attention now</strong><span>{[overdueTasks.length > 0 && `${overdueTasks.length} task${overdueTasks.length > 1 ? 's' : ''} overdue`, highPriority.length > 0 && `${highPriority.length} high-priority patient${highPriority.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}</span></div><div className="attention-actions">{overdueTasks.length > 0 && <button className="secondary-button" onClick={() => go('My tasks')}>Review tasks <ArrowRight size={13} /></button>}{highPriority.length > 0 && <button className="secondary-button" onClick={() => go('My patients')}>View patients <ArrowRight size={13} /></button>}</div></div>}
    {page === 'My shift' && <div className="overview-grid"><div className="main-column">
      <section className="panel"><div className="panel-heading"><div><h2>Tasks assigned to you <span className="count">{openTasks.length}</span></h2><p>Acknowledge, complete, or report a delay. Changes are saved and shared with your charge nurse.</p></div></div><div className="nurse-task-grid">{sortedTasks.slice(0, 4).map(taskCard)}{!sortedTasks.length && <div className="empty-state"><ClipboardCheck size={25} /><h3>No tasks assigned</h3><p>You're all caught up.</p></div>}</div>{sortedTasks.length > 4 && <button className="panel-bottom-link" onClick={() => go('My tasks')}>View all {myTasks.length} tasks <ArrowRight size={14} /></button>}</section>
    </div><aside className="right-column">
      <section className="panel updates-panel"><div className="panel-heading"><h2>Your recent updates</h2><span className="subtle-icon"><Activity size={17} /></span></div><div className="update-feed">{myUpdates.slice(0, 4).map((update) => <button className="update-item" key={update.id} onClick={() => setModal({ type: 'saved', item: update })}><div className="update-topline"><span className="avatar small blue" aria-hidden="true">{myInitials}</span><strong>Saved</strong><time>{minutesSince(update.createdAt, now)}m ago</time></div><div className="update-body"><div className="update-patient">{patientLabel(update.patient)}</div><p>{update.text}</p><div className="update-labels">{update.urgent ? <Badge tone="red">Urgent</Badge> : <Badge>{update.category}</Badge>}{update.editHistory?.length > 0 && <span className="processing-note">Corrected</span>}{update.processing === 'failed' && <span className="processing-note">AI processing failed · update kept</span>}</div></div></button>)}{!myUpdates.length && <div className="empty-state"><Send size={22} /><p>No updates yet.</p></div>}</div><button className="panel-bottom-link" onClick={() => go('Submit update')}>Submit a new update <ArrowRight size={14} /></button></section>
    </aside></div>}

    {page === 'My patients' && <section className="panel patients-panel"><div className="panel-heading"><div><h2>Your patients <span className="count">{myPatients.length}</span></h2><p>Patients assigned to you during this incident.</p></div></div><div className="table-scroll"><table><thead><tr><th>Patient</th><th>Priority</th><th>Latest concern</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{myPatients.map((patient) => { const unverified = isPatientUnverified(patient, now, freshness); return <tr key={patient.id}>
      <td><button className="patient-name" onClick={() => setModal({ type: 'patient', item: patient })}>{patient.name}</button><span className="cell-secondary">Room {patient.room} <span>·</span> {patient.id}</span></td>
      <td><Priority value={patient.priority} /></td>
      <td><span className="concern">{patient.concern}</span><span className={`cell-secondary ${unverified ? 'warning-text' : ''}`}>{unverified ? <><TriangleAlert size={12} /> {patient.verifiedAt ? `Last verified ${minutesSince(patient.verifiedAt, now)}m ago` : 'Not yet verified'}</> : <><CheckCheck size={13} /> Verified {minutesSince(patient.verifiedAt, now)}m ago</>}</span></td>
      <td><button className="icon-button" aria-label={`View ${patient.name}`} onClick={() => setModal({ type: 'patient', item: patient })}><ChevronRight size={17} /></button></td>
    </tr>; })}</tbody></table>{!myPatients.length && <div className="empty-state"><HeartPulse size={22} /><p>No patients are assigned to you yet.</p></div>}</div><div className="table-footer"><span>Showing {myPatients.length} patients in your care</span><span><ShieldCheck size={13} /> Synthetic patient data</span></div></section>}

    {page === 'My tasks' && <section className="panel"><div className="panel-heading"><div><h2>My tasks <span className="count">{myTasks.length}</span></h2><p>Report completion, delays, or work you can't complete. Changes are saved for your charge nurse.</p></div></div><div className="nurse-task-grid full">{sortedTasks.map(taskCard)}{!sortedTasks.length && <div className="empty-state"><ClipboardCheck size={25} /><h3>No tasks assigned</h3><p>You're all caught up.</p></div>}</div></section>}

    {page === 'Submit update' && <section className="panel submit-panel"><div className="panel-heading"><div><h2><Send size={16} className="teal-text" /> {editingId ? 'Correct your update' : 'Submit a nurse update'}</h2><p>{editingId ? 'Edit the update below. The previous version is kept as correction history.' : 'Share a patient update, concern, or task status with the charge nurse.'}</p></div>{editingId && <button className="secondary-button" onClick={resetForm}>Cancel correction</button>}</div>
      {!incidentActive && <div className="notice amber-notice" role="alert"><TriangleAlert size={16} /> This incident is closed. New updates and corrections can't be saved.</div>}
      <form className="update-form" onSubmit={submitUpdate}>
        <label>Patient<select value={form.patient} onChange={(event) => changeForm({ patient: event.target.value })} required disabled={Boolean(editingId)}><option value="" disabled>Select a patient…</option>{(editingId ? data.patients : myPatients).map((patient) => <option value={patient.id} key={patient.id}>{patient.name} · Room {patient.room}</option>)}{editingId && !patientFor(form.patient) && <option value={form.patient}>{form.patient}</option>}</select></label>
        <label>Category<select value={form.category} onChange={(event) => changeForm({ category: event.target.value })}>{updateCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label className="full-width">Update<textarea rows={4} value={form.text} onChange={(event) => changeForm({ text: event.target.value })} placeholder="Describe the patient condition, concern, or task status in plain language…" required /></label>
        <label className="checkbox-row"><input type="checkbox" checked={form.urgent} onChange={(event) => changeForm({ urgent: event.target.checked })} /> Mark this update as urgent</label>
        <div className="form-actions"><button type="submit" className="primary-button" disabled={submitting || !incidentActive || !form.patient || !form.text.trim()}>{submitting ? <LoaderCircle size={15} className="auth-spinner" /> : <Send size={15} />} {submitting ? 'Saving…' : editingId ? 'Save correction' : 'Submit update'}</button><span className="muted small-text"><ShieldCheck size={12} /> Saved with your name and the time</span></div>
        {submitError && <div className="notice amber-notice full-width" role="alert"><TriangleAlert size={16} /> {submitError}</div>}
      </form>
      <div className="notice">Your update is saved to CareBridge before any AI processing, so it is never lost if AI processing fails. Corrections keep every earlier version.</div>
    </section>}
  </>;

  return <div className="app-shell">
    <p className="sr-only" aria-live="polite" role="status">{announcement}</p>
    {mobileMenu && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
    <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}><a className="brand" href="#shift" onClick={(event) => { event.preventDefault(); go('My shift'); }}><span className="brand-mark"><Plus size={24} strokeWidth={3} /></span>CareBridge<span className="brand-period">.</span></a><div className="workspace"><span className="workspace-icon"><Activity size={18} /></span><div><strong>Westbrook Medical</strong><span>Nurse workspace</span></div></div><div className="nav-label">MY SHIFT</div><nav>{navigation.map(({ label, icon: Icon, count }) => <button key={label} className={`nav-item ${page === label ? 'active' : ''}`} onClick={() => go(label)} aria-current={page === label ? 'page' : undefined}><Icon size={18} /><span>{label}</span>{count ? <span className="nav-count">{count}</span> : null}</button>)}</nav><div className="sidebar-bottom"><div className="continuity-note"><span className="continuity-icon"><ShieldCheck size={19} /></span><strong>Continuity starts with you.</strong><p>Your updates keep the whole team aligned during downtime.</p><span className="small-caps">HERE WHEN IT MATTERS</span></div><button className="nav-item" onClick={() => setModal({ type: 'about' })}><CircleHelp size={18} /><span>About this view</span></button><div className="profile"><span className="avatar profile-avatar blue" aria-hidden="true">{myInitials}</span><div><strong>{me.displayName}</strong><span>Registered nurse · Signed in</span></div></div><button className="nav-item sign-out-item" onClick={onSignOut}><LogOut size={18} /><span>Sign out</span></button></div></aside>
    <div className="workspace-main"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileMenu(true)}><Menu size={21} /></button><span>Nurse</span><ChevronRight size={13} /><strong>{page}</strong></div><div className="topbar-right"><button className="icon-button" aria-label="Refresh" title="Refresh" onClick={() => load()}><RefreshCw size={17} /></button><span className="avatar top-avatar blue" title={me.displayName} aria-hidden="true">{myInitials}</span><button className="icon-button" aria-label="Sign out" title="Sign out" onClick={onSignOut}><LogOut size={17} /></button></div></header>
      <main><div className="incident-banner"><span className="incident-icon"><Activity size={17} /></span><strong>{incident.type ?? 'Incident'}</strong><Badge tone={incidentActive ? 'amber' : 'neutral'}>{incidentActive ? 'Incident active' : 'Incident closed'}</Badge><span className="incident-description">{incidentActive ? 'Downtime coordination is in progress' : 'Normal services have resumed'}</span><div className="incident-time"><Clock3 size={14} /><strong>{Math.floor(elapsed / 60)}h {String(elapsed % 60).padStart(2, '0')}m</strong><span>{incidentActive ? 'elapsed' : 'total'}</span></div></div>
        {refreshFailed && <div className="notice amber-notice" role="status"><TriangleAlert size={16} /> Couldn't refresh from CareBridge. Showing the last data loaded. <button className="text-button" onClick={() => load()}>Try again</button></div>}
        <section className="page-heading"><div><div className="eyebrow">{String(incident.unit ?? '').toUpperCase()}</div><h1>{page === 'My shift' ? `Welcome back, ${firstName}.` : page === 'My patients' ? 'Your patients, in view.' : page === 'My tasks' ? 'Your tasks for this shift.' : 'Share what you are seeing.'}</h1><p>{page === 'My shift' ? 'Your patients, tasks, and updates in one place.' : page === 'My patients' ? 'Review coordination needs for patients in your care.' : page === 'My tasks' ? 'Mark tasks complete or report a delay.' : 'Submit a structured or plain-language update in seconds.'}</p></div>{page !== 'Submit update' && incidentActive && <button className="secondary-button handoff-button" onClick={() => go('Submit update')}><Send size={15} /> New update <ArrowUpRight size={14} /></button>}</section>
        {mainContent}
        <footer className="page-footer"><span><span className="brand-mini"><Plus size={12} strokeWidth={3} /></span> CareBridge <span>·</span> Continuity of care, together.</span><span>Synthetic data <span>·</span> Times in Pacific</span></footer>
      </main>
    </div>
    <dialog ref={dialog} className="detail-dialog" onCancel={() => setModal(null)} onClick={(event) => { if (event.target === dialog.current) setModal(null); }} aria-label="CareBridge details"><div className="dialog-content"><button className="icon-button modal-close" aria-label="Close details" onClick={() => setModal(null)} autoFocus><X size={21} /></button>{renderModal()}</div></dialog>
  </div>;
}
