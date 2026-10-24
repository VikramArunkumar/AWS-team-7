// Charge nurse dashboard, backed by the CareBridge API.
//
// Reads GET /incidents/{id}/dashboard. Decisions go through the backend:
// approving or rejecting AI recommendations, running AI review on a saved
// update, and reassigning or updating tasks. The backend enforces the charge
// nurse role and human approval (NFR-24); these controls only call it.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowRight, ArrowUpRight, Bell, BookOpen, CheckCheck, ChevronRight, CircleHelp, ClipboardCheck, ClipboardList, Clock3, FileText, HeartPulse, LayoutDashboard, LoaderCircle, LogOut, Menu, Plus, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, TriangleAlert, Users, X } from 'lucide-react';
import PolicyAssistant from './PolicyAssistant.jsx';
import { Avatar, Badge, Priority, statusTone } from './ui.jsx';
import { minutesSince, formatTime } from './data.js';
import { initialsFor } from './auth/AuthGate.jsx';
import { SessionExpiredError } from './api/client.js';
import { processingLabel, listOrNotRecorded } from './nurse/workspace.js';
import {
  staffDirectory, isTaskOpen, isTaskOverdue, isPatientUnverified, filterPatients, filterTasks,
  taskChanges, approvalDefaults, dueFromChoice, sourceUpdatesFor, decisionErrorMessage, aiErrorMessage,
  PRIORITIES, SETTABLE_STATUSES, TASK_FILTERS, DUE_CHOICES,
} from './charge/dashboard.js';

const REFRESH_MS = 30_000;
const shortName = (name) => { const [first, last] = String(name).split(' '); return last ? `${first} ${last[0]}.` : first; };

export function ChargeDashboard({ me, onSignOut, api, incidentId, onSessionExpired }) {
  const myInitials = initialsFor(me.displayName);
  const [page, setPage] = useState('Overview');
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All patients');
  const [nurseFilter, setNurseFilter] = useState('all');
  const [sort, setSort] = useState('priority');
  const [showFilters, setShowFilters] = useState(false);
  const [modal, setModal] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [taskFilter, setTaskFilter] = useState('All statuses');
  const [taskSort, setTaskSort] = useState('due');
  const dialog = useRef(null);

  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [loadError, setLoadError] = useState(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);

  // Form state for whichever decision dialog is open.
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [announcement, setAnnouncement] = useState('');

  const handleAuthError = useCallback((err) => {
    if (err instanceof SessionExpiredError || err?.status === 401) { void onSessionExpired?.(); return true; }
    return false;
  }, [onSessionExpired]);

  const load = useCallback(async ({ background = false } = {}) => {
    try {
      const next = await api.getDashboard(incidentId);
      setData(next);
      setLoadState('ready');
      setLoadError(null);
      setRefreshFailed(false);
      setLastLoadedAt(Date.now());
      return next;
    } catch (err) {
      if (handleAuthError(err)) return null;
      setRefreshFailed(true);
      if (!background) {
        setLoadError(err);
        setLoadState((state) => (state === 'ready' ? state : 'error'));
      }
      return null;
    }
  }, [api, incidentId, handleAuthError]);

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

  const go = (next) => { setPage(next); setSearch(''); setMobileMenu(false); };
  const openModal = (next, initialForm = {}) => { setModal(next); setForm(initialForm); setActionError(null); setBusy(false); };

  if (loadState !== 'ready' || !data) {
    const notFound = loadError?.status === 404;
    return <main className="auth-screen">
      <section className="panel auth-card" aria-busy={loadState === 'loading'} aria-live="polite">
        <div className="brand auth-brand"><span className="brand-mark"><Plus size={24} strokeWidth={3} /></span>CareBridge<span className="brand-period">.</span></div>
        {loadState === 'loading'
          ? <h1><LoaderCircle className="auth-spinner" size={20} aria-hidden="true" />Loading the unit dashboard</h1>
          : <>
            <h1>{notFound ? 'No active incident found' : "The dashboard couldn't load"}</h1>
            <div className="notice amber-notice auth-notice" role="alert"><TriangleAlert size={16} aria-hidden="true" /><span>{notFound ? `CareBridge has no incident ${incidentId}. Check VITE_INCIDENT_ID or seed the demo incident.` : (loadError?.message ?? 'Try again in a moment.')}</span></div>
            <div className="auth-actions">
              <button className="primary-button" onClick={() => load()}><RefreshCw size={15} aria-hidden="true" /> Try again</button>
              <button className="secondary-button" onClick={onSignOut}><LogOut size={15} aria-hidden="true" /> Sign out</button>
            </div>
          </>}
      </section>
    </main>;
  }

  const { incident, patients, tasks, updates, recommendations } = data;
  const freshness = data.meta?.verificationFreshnessMinutes ?? 60;
  const { personFor, nurses } = staffDirectory(data.staff);
  const nameOf = (id) => personFor(id).name;
  const patientFor = (id) => patients.find((p) => p.id === id);
  const patientName = (id) => patientFor(id)?.name ?? id;
  const roomOf = (id) => patientFor(id)?.room ?? '—';
  const incidentActive = incident.status === 'active';
  const unverified = patients.filter((p) => isPatientUnverified(p, now, freshness));
  const openTasks = tasks.filter(isTaskOpen);
  const overdue = tasks.filter((t) => isTaskOverdue(t, now));
  const unconfirmed = tasks.filter((t) => t.status === 'Unconfirmed');
  const urgentUpdates = updates.filter((u) => u.urgent);
  const proposed = recommendations.filter((r) => r.status === 'proposed');
  const decided = recommendations.filter((r) => r.status !== 'proposed');
  const supplyUpdate = updates.find((u) => u.category === 'Supply request');
  const elapsed = minutesSince(incident.startedAt, incident.endedAt ? Date.parse(incident.endedAt) : now);
  const filteredPatients = filterPatients(patients, { search, filter, nurse: nurseFilter, sort, now, freshness, nameOf });
  const filteredTasks = filterTasks(tasks, { search, status: taskFilter, sort: taskSort, now, nameOf, patientName });

  const navigation = [
    { label: 'Overview', icon: LayoutDashboard }, { label: 'Patients', icon: HeartPulse },
    { label: 'Tasks', icon: ClipboardList, count: openTasks.length }, { label: 'Care team', icon: Users },
    { label: 'AI review', icon: Sparkles, count: proposed.length }, { label: 'Policy assistant', icon: BookOpen },
  ];

  const openUpdate = (update) => openModal({ type: 'update', item: update });
  const openUpdateById = (id) => { const u = updates.find((x) => x.id === id); if (u) openUpdate(u); };
  const openTask = (task) => openModal({ type: 'task', item: task }, { assignedNurse: task.nurse ?? '', priority: task.priority, status: task.status, due: 'keep' });
  const openReview = (rec) => openModal({ type: 'recommendation', item: rec }, approvalDefaults(rec, patientFor(rec.patient), nurses));

  // ---- actions (each refreshes from the API so the screen shows stored data) ----
  const runAction = async (fn, { onError }) => {
    setBusy(true);
    setActionError(null);
    try {
      return await fn();
    } catch (err) {
      if (handleAuthError(err)) return undefined;
      setActionError(onError(err));
      if (err?.code === 'already_decided' || err?.code === 'already_processed') void load({ background: true });
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const approve = (rec) => runAction(async () => {
    const res = await api.approveRecommendation(incidentId, rec.id, {
      assignedNurse: form.assignedNurse, priority: form.priority, description: form.description.trim(), dueAt: dueFromChoice(form.due, Date.now()),
    });
    await load({ background: true });
    setAnnouncement(`Approved. Task created for ${nameOf(res.task.nurse)}.`);
    setModal({ type: 'decided', item: { ...rec, status: 'approved' }, task: res.task });
  }, { onError: decisionErrorMessage });

  const reject = (rec) => runAction(async () => {
    await api.rejectRecommendation(incidentId, rec.id, { reason: form.reason?.trim() });
    await load({ background: true });
    setAnnouncement('Recommendation rejected. Nothing was applied.');
    setModal({ type: 'decided', item: { ...rec, status: 'rejected', rejectReason: form.reason?.trim() || null } });
  }, { onError: decisionErrorMessage });

  const runAiReview = (update) => runAction(async () => {
    const res = await api.processUpdate(incidentId, update.id);
    await load({ background: true });
    const count = res.recommendations?.length ?? 0;
    setAnnouncement(`AI review created ${count} recommendation${count === 1 ? '' : 's'} to review.`);
    setModal({ type: 'ai-done', item: update, count });
  }, { onError: aiErrorMessage });

  const saveTask = (task) => runAction(async () => {
    const patch = taskChanges(task, form, Date.now());
    if (!Object.keys(patch).length) return;
    const saved = await api.updateTask(incidentId, task.id, patch);
    const next = await load({ background: true });
    const fresh = next?.tasks.find((t) => t.id === task.id) ?? saved;
    setAnnouncement(`Task saved: ${task.description}.`);
    openModal({ type: 'task', item: fresh, saved: true }, { assignedNurse: fresh.nurse ?? '', priority: fresh.priority, status: fresh.status, due: 'keep' });
  }, { onError: (err) => `Not saved. ${err?.message ?? 'Try again.'}` });

  // ---- panels ----
  const patientTable = <section className="panel patients-panel">
    <div className="panel-heading"><div><h2>Patient overview <span className="count">{patients.length}</span></h2><p>Every patient in this incident, prioritized.</p></div><button className={`icon-button ${showFilters ? 'selected' : ''}`} aria-label="Toggle patient sorting and nurse filters" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal size={17} /></button></div>
    <div className="patient-toolbar"><div className="tabs" aria-label="Patient filters">{['All patients', 'High priority', 'Needs verification'].map((name) => <button key={name} onClick={() => setFilter(name)} className={filter === name ? 'active' : ''} aria-pressed={filter === name}>{name}{name === 'Needs verification' && <span>{unverified.length}</span>}</button>)}</div></div>
    {showFilters && <div className="filter-row"><label>Assigned nurse<select value={nurseFilter} onChange={(event) => setNurseFilter(event.target.value)}><option value="all">All nurses</option>{nurses.map((nurse) => <option value={nurse.id} key={nurse.id}>{nurse.name}</option>)}</select></label><label>Sort by<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="priority">Priority</option><option value="name">Patient name</option><option value="room">Room</option></select></label></div>}
    <div className="table-scroll"><table><thead><tr><th>Patient</th><th>Priority <ArrowDown size={12} /></th><th>Latest concern</th><th>Assigned nurse</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{filteredPatients.map((patient) => { const stale = isPatientUnverified(patient, now, freshness); return <tr key={patient.id}>
      <td><button className="patient-name" onClick={() => openModal({ type: 'patient', item: patient })}>{patient.name}</button><span className="cell-secondary">Room {patient.room} <span>·</span> {patient.id}</span></td>
      <td><Priority value={patient.priority} /></td><td><span className="concern">{patient.concern}</span><span className={`cell-secondary ${stale ? 'warning-text' : ''}`}>{stale ? <><TriangleAlert size={12} /> {patient.verifiedAt ? `Last verified ${minutesSince(patient.verifiedAt, now)}m ago` : 'Not yet verified'}</> : <><CheckCheck size={13} /> Verified {minutesSince(patient.verifiedAt, now)}m ago</>}</span></td>
      <td><span className="nurse-cell"><Avatar person={personFor(patient.nurse)} small />{nameOf(patient.nurse)}</span></td><td><button className="icon-button" aria-label={`View ${patient.name}`} onClick={() => openModal({ type: 'patient', item: patient })}><ChevronRight size={17} /></button></td>
    </tr>; })}</tbody></table>{!filteredPatients.length && <div className="empty-state"><Search size={25} /><h3>No matching patients</h3><p>Try another name, room, nurse, or filter.</p><button className="text-button" onClick={() => { setSearch(''); setFilter('All patients'); setNurseFilter('all'); }}>Clear filters</button></div>}</div>
    <div className="table-footer"><span>Showing {filteredPatients.length} of {patients.length} patients</span><span><ShieldCheck size={13} /> Synthetic patient data</span></div>
  </section>;

  const recommendationCard = (rec) => <button className="recommendation" key={rec.id} onClick={() => openReview(rec)}><span className="eyebrow">AI-GENERATED <span>·</span> ROOM {roomOf(rec.patient)}</span><h3>{rec.title}</h3>{rec.priority && <small className="muted">Suggested priority: {rec.priority}</small>}<span className="review-link">Review sources <ArrowRight size={14} /></span></button>;
  const reviewPanel = <section className="panel review-panel"><div className="panel-heading"><div><h2><Sparkles size={17} className="teal-text" /> A second set of eyes</h2><p>AI recommendations waiting for your decision. Verify before acting.</p></div><Badge tone="teal">{proposed.length} to review</Badge></div>{proposed.length ? <div className="recommendation-grid">{proposed.map(recommendationCard)}</div> : <div className="empty-state"><Sparkles size={22} /><p>No recommendations waiting. Run AI review on a nurse update to get suggestions.</p></div>}<div className="ai-footnote"><ShieldCheck size={13} /> Nothing is applied until you approve it.</div></section>;

  const errorNotice = actionError && <div className="notice amber-notice" role="alert"><TriangleAlert size={16} /> {actionError}</div>;
  const nurseSelect = (value, onChange, label = 'Assign to') => <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)} required>{!nurses.some((n) => n.id === value) && <option value="" disabled>Choose a nurse…</option>}{nurses.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>;

  function renderModal() {
    if (!modal) return null;
    const item = modal.item;
    if (modal.type === 'patient') {
      const patientTasks = tasks.filter((t) => t.patient === item.id);
      const patientUpdates = updates.filter((u) => u.patient === item.id);
      return <><span className="eyebrow">SYNTHETIC PATIENT · ROOM {item.room}</span><h2>{item.name}</h2><p className="modal-lead">{item.id}{item.age ? ` · ${item.age} years` : ''} · Assigned to {nameOf(item.nurse)}</p><Priority value={item.priority} />
        <div className="detail-block"><h3>Current coordination concern</h3><p>{item.detail || item.concern || 'None recorded.'}</p></div>
        <div className="detail-block"><h3>Continuity profile</h3><dl className="detail-grid"><dt>Allergies</dt><dd>{listOrNotRecorded(item.allergies)}</dd><dt>Critical medications</dt><dd>{listOrNotRecorded(item.medications)}</dd><dt>Relevant conditions</dt><dd>{listOrNotRecorded(item.conditions)}</dd><dt>Care priorities</dt><dd>{item.carePriorities || 'Not recorded'}</dd><dt>Risk indicators</dt><dd>{Array.isArray(item.riskIndicators) && item.riskIndicators.length ? item.riskIndicators.join(', ') : 'None recorded'}</dd></dl></div>
        <div className="detail-block"><h3>Information freshness</h3><p>{item.verifiedAt ? `Last verified at ${formatTime(item.verifiedAt)} Pacific (${minutesSince(item.verifiedAt, now)} minutes ago).` : 'This continuity profile has not been verified.'}</p><p className="muted">CareBridge flags information after {freshness} minutes without verification. Demo setting, not a facility policy.</p></div>
        <h3>Tasks</h3>{patientTasks.map((task) => <button className="detail-list-item" key={task.id} onClick={() => openTask(task)}><ClipboardList size={17} /><span>{task.description}<small>{task.status} · {nameOf(task.nurse)}{task.dueAt ? ` · Due ${formatTime(task.dueAt)} Pacific` : ''}</small></span><ChevronRight size={16} /></button>)}{!patientTasks.length && <p className="muted">No tasks for this patient.</p>}
        <h3 style={{ marginTop: 23 }}>Original nurse updates</h3>{patientUpdates.map((u) => <button className="detail-list-item" key={u.id} onClick={() => openUpdate(u)}><FileText size={16} /><span>{u.text}<small>{nameOf(u.nurse)} · {formatTime(u.createdAt)} Pacific{u.urgent ? ' · Urgent' : ''}</small></span><ChevronRight size={16} /></button>)}{!patientUpdates.length && <p className="muted">No updates for this patient yet.</p>}</>;
    }
    if (modal.type === 'update') {
      const canRun = incidentActive && (item.processing === 'not_processed' || item.processing === 'failed');
      const history = item.editHistory ?? [];
      return <><span className="eyebrow">ORIGINAL NURSE UPDATE · {item.id}</span><h2>{patientName(item.patient)}</h2><p className="modal-lead">Room {roomOf(item.patient)} · {nameOf(item.nurse)} · {formatTime(item.createdAt)} Pacific</p>{item.urgent && <Badge tone="red">Urgent</Badge>}<div className="source-quote">{item.text}</div><p className="muted">Category: {item.category}{item.editedAt ? ` · Corrected by the author ${formatTime(item.editedAt)} Pacific` : ''}</p>
        <div className={item.processing === 'failed' ? 'notice amber-notice' : 'notice'}>{processingLabel(item.processing)}</div>
        {history.length > 0 && <div className="detail-block"><h3>Earlier versions <span className="count">{history.length}</span></h3>{history.map((v, i) => <div className="detail-list-item" key={i}><FileText size={16} /><span>{v.text}<small>{v.category ? `${v.category} · ` : ''}replaced {formatTime(v.replacedAt)} Pacific by {nameOf(v.by)}</small></span></div>)}</div>}
        {errorNotice}
        {canRun && <button className="primary-button modal-footer-button" disabled={busy} onClick={() => runAiReview(item)}>{busy ? <LoaderCircle size={15} className="auth-spinner" /> : <Sparkles size={15} />} {item.processing === 'failed' ? 'Retry AI review' : 'Run AI review'}</button>}
        <p className="muted">This is the nurse's original update. AI output is stored separately and never changes it.</p></>;
    }
    if (modal.type === 'ai-done') return <><span className="eyebrow"><Sparkles size={14} /> AI REVIEW COMPLETE · {item.id}</span><h2>{modal.count ? `${modal.count} recommendation${modal.count === 1 ? '' : 's'} to review` : 'No recommendations'}</h2><p className="modal-lead">{patientName(item.patient)} · Room {roomOf(item.patient)}</p><div className="notice">AI-generated suggestions are waiting for your decision. Nothing has been assigned or changed.</div><button className="primary-button modal-footer-button" onClick={() => { setModal(null); go('AI review'); }}>Go to AI review <ArrowRight size={15} /></button></>;
    if (modal.type === 'task') {
      const patch = taskChanges(item, form, now);
      const dirty = Object.keys(patch).length > 0;
      return <><span className="eyebrow">TASK · {item.id}</span><h2>{item.description}</h2><p className="modal-lead">{patientName(item.patient)} · Room {roomOf(item.patient)}</p><Priority value={item.priority} /> <Badge tone={statusTone(item.status)}>{item.status}</Badge>
        <dl className="detail-grid"><dt>Assigned nurse</dt><dd>{nameOf(item.nurse)}</dd><dt>Due</dt><dd>{item.dueAt ? `${formatTime(item.dueAt)} Pacific${isTaskOverdue(item, now) ? ` · ${minutesSince(item.dueAt, now)}m overdue` : ''}` : 'No due time'}</dd><dt>Created by</dt><dd>{nameOf(item.creator)}</dd><dt>Created</dt><dd>{item.createdAt ? `${formatTime(item.createdAt)} Pacific` : '—'}</dd>{item.fromRecommendation && <><dt>Source</dt><dd>Approved AI recommendation {item.fromRecommendation}</dd></>}</dl>
        {modal.saved && <div className="notice" role="status"><CheckCheck size={14} /> Saved. The assigned nurse sees this on their next refresh.</div>}
        {incidentActive && <form className="update-form dialog-form" onSubmit={(event) => { event.preventDefault(); void saveTask(item); }}>
          {nurseSelect(form.assignedNurse, (v) => setForm((f) => ({ ...f, assignedNurse: v })), 'Assigned nurse')}
          <label>Priority<select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label>Status<select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>{!SETTABLE_STATUSES.includes(item.status) && <option value={item.status}>{item.status} (no change)</option>}{SETTABLE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Due<select value={form.due} onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))}><option value="keep">Keep current due time</option>{DUE_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
          <div className="form-actions"><button className="primary-button" type="submit" disabled={busy || !dirty}>{busy ? <LoaderCircle size={15} className="auth-spinner" /> : <CheckCheck size={15} />} {busy ? 'Saving…' : 'Save changes'}</button>{!dirty && <span className="muted small-text">Change a field to save.</span>}</div>
        </form>}
        {errorNotice}</>;
    }
    if (modal.type === 'recommendation') {
      const sources = sourceUpdatesFor(item, updates);
      const header = <><span className="eyebrow"><Sparkles size={14} /> AI-GENERATED RECOMMENDATION · {item.id}</span><h2>{item.title}</h2><p className="modal-lead">{patientName(item.patient)} · Room {roomOf(item.patient)}</p>
        <div className="detail-block"><h3>Why this is suggested</h3><p>{item.reason}</p></div>
        <h3>Supporting sources</h3>{sources.map(({ id, update }) => update ? <button className="detail-list-item" key={id} onClick={() => openUpdate(update)}><FileText size={18} /><span>Original nurse update · {id}<small>{nameOf(update.nurse)} · {formatTime(update.createdAt)} Pacific</small></span><ArrowUpRight size={16} /></button> : <div className="detail-list-item" key={id}><TriangleAlert size={18} /><span>Source {id} is not available<small>Do not act on this recommendation without a source.</small></span></div>)}{!sources.length && <p className="muted">No source updates are linked. Do not act on this recommendation without a source.</p>}</>;
      if (item.status !== 'proposed') return <>{header}<div className="notice">This recommendation was {item.status} by {nameOf(item.decidedBy)}{item.decidedAt ? ` at ${formatTime(item.decidedAt)} Pacific` : ''}.{item.rejectReason ? ` Reason: ${item.rejectReason}` : ''}</div>{item.resultingTaskId && <button className="secondary-button" onClick={() => { const t = tasks.find((x) => x.id === item.resultingTaskId); if (t) openTask(t); }}>View resulting task <ArrowRight size={14} /></button>}</>;
      return <>{header}
        <div className="notice">AI-generated. Verify the sources and current circumstances before acting. Approving creates a task for the nurse you choose; nothing happens until you decide.</div>
        {incidentActive ? <>
          <h3>Your decision</h3>
          <form className="update-form dialog-form" onSubmit={(event) => { event.preventDefault(); void approve(item); }}>
            <label className="full-width">Task description<textarea rows={2} value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} required /></label>
            {nurseSelect(form.assignedNurse ?? '', (v) => setForm((f) => ({ ...f, assignedNurse: v })))}
            <label>Priority<select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></label>
            <label>Due<select value={form.due} onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))}>{DUE_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
            <label className="full-width">Reason if rejecting (optional)<textarea rows={2} value={form.reason ?? ''} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></label>
            <div className="form-actions"><button className="primary-button" type="submit" disabled={busy || !form.assignedNurse || !form.description?.trim()}>{busy ? <LoaderCircle size={15} className="auth-spinner" /> : <CheckCheck size={15} />} Approve and create task</button><button className="secondary-button" type="button" disabled={busy} onClick={() => reject(item)}>Reject</button></div>
          </form>
          {errorNotice}
          {!nurses.length && <p className="muted">No nurses are available to assign.</p>}
        </> : <div className="notice amber-notice">This incident is closed. Recommendations can no longer be decided.</div>}</>;
    }
    if (modal.type === 'decided') {
      const approved = item.status === 'approved';
      return <><span className="eyebrow">{approved ? 'APPROVED' : 'REJECTED'} · {item.id}</span><h2>{approved ? 'Task created.' : 'Recommendation rejected.'}</h2><p className="modal-lead">{item.title}</p>
        {approved && modal.task ? <dl className="detail-grid"><dt>Task</dt><dd>{modal.task.description}</dd><dt>Assigned nurse</dt><dd>{nameOf(modal.task.nurse)}</dd><dt>Priority</dt><dd>{modal.task.priority}</dd><dt>Due</dt><dd>{modal.task.dueAt ? `${formatTime(modal.task.dueAt)} Pacific` : 'No due time'}</dd><dt>Status</dt><dd>{modal.task.status} until the nurse acknowledges it</dd></dl>
          : <div className="notice">Nothing was applied.{item.rejectReason ? ` Reason recorded: ${item.rejectReason}` : ''}</div>}
        <p className="muted">Your decision is recorded in the audit log with your name and the time.</p>
        <button className="secondary-button modal-footer-button" onClick={() => setModal(null)}>Done</button></>;
    }
    if (modal.type === 'handoff') return <><span className="eyebrow">INCIDENT {incident.incidentId} · HANDOFF PREVIEW</span><h2>Keep the next shift informed.</h2><p className="modal-lead">{incident.unit} · {formatTime(now)} Pacific</p><div className="notice">{incidentActive ? 'The incident remains active.' : 'The incident is closed.'} This preview does not close the incident or send a handoff.</div><dl className="detail-grid"><dt>Incident duration</dt><dd>{Math.floor(elapsed / 60)}h {elapsed % 60}m</dd><dt>Patients</dt><dd>{patients.length}</dd><dt>Open / overdue tasks</dt><dd>{openTasks.length} / {overdue.length}</dd><dt>Unconfirmed tasks</dt><dd>{unconfirmed.length}</dd><dt>Urgent updates</dt><dd>{urgentUpdates.length}</dd><dt>Unverified profiles</dt><dd>{unverified.length}</dd><dt>Recommendations awaiting decision</dt><dd>{proposed.length}</dd></dl><h3>Outstanding coordination concerns</h3><ul className="handoff-list">{patients.filter((p) => p.priority === 'High' || isPatientUnverified(p, now, freshness)).map((p) => <li key={p.id}><strong>Room {p.room} · {p.name}</strong><span>{p.concern}</span></li>)}</ul><p className="muted">Compiled directly from stored CareBridge records. Not an AI-generated summary.</p></>;
    if (modal.type === 'all-updates') return <><span className="eyebrow">ORIGINAL SOURCE UPDATES</span><h2>Updates from your team</h2><p className="modal-lead">Newest first. Select an update to read it or run AI review.</p>{updates.map((u) => <button className="detail-list-item" key={u.id} onClick={() => openUpdate(u)}><Avatar person={personFor(u.nurse)} small /><span>{patientName(u.patient)}<small>{nameOf(u.nurse)} · {formatTime(u.createdAt)} Pacific · {u.category}{u.urgent ? ' · Urgent' : ''}</small></span><ChevronRight size={16} /></button>)}{!updates.length && <p className="muted">No updates yet.</p>}</>;
    return <><span className="eyebrow">ABOUT THIS VIEW</span><h2>A clearer picture during downtime.</h2><p className="modal-lead">CareBridge helps charge nurses see coordination needs at a glance.</p><p>Patients, tasks, nurse updates, and AI recommendations come from CareBridge and refresh every 30 seconds. Approving a recommendation, rejecting it, and changing tasks are saved and audited. AI review is a labeled stub until Amazon Bedrock is connected. All people and patients are synthetic.</p><p>CareBridge is a coordination aid and does not make clinical decisions.</p></>;
  }

  const pageTitle = { Overview: 'Your unit, at a glance.', Patients: 'Every patient in view.', Tasks: 'Keep care moving.', 'Care team': 'Your team, connected.', 'AI review': 'Your judgment comes first.' }[page] ?? 'Find the right guidance.';
  const pageLead = { Overview: 'Stay ahead of urgent needs. Keep your team connected.', Patients: 'Review coordination needs and verify continuity information.', Tasks: 'See what needs attention, who owns it, and what’s next.', 'Care team': 'Current assignments and workload for each nurse.', 'AI review': 'Review supporting evidence before making a decision.' }[page] ?? 'Facility-specific answers need verified policy sources.';

  return <div className="app-shell">
    <p className="sr-only" aria-live="polite" role="status">{announcement}</p>
    {mobileMenu && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
    <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}><a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); go('Overview'); }}><span className="brand-mark"><Plus size={24} strokeWidth={3} /></span>CareBridge<span className="brand-period">.</span></a><div className="workspace"><span className="workspace-icon"><Activity size={18} /></span><div><strong>Westbrook Medical</strong><span>Care coordination</span></div></div><div className="nav-label">WORKSPACE</div><nav>{navigation.map(({ label, icon: Icon, count }) => <button key={label} className={`nav-item ${page === label ? 'active' : ''}`} onClick={() => go(label)} aria-current={page === label ? 'page' : undefined}><Icon size={18} /><span>{label}</span>{count ? <span className="nav-count">{count}</span> : null}</button>)}</nav><div className="sidebar-bottom"><div className="continuity-note"><span className="continuity-icon"><ShieldCheck size={19} /></span><strong>Continuity starts with you.</strong><p>A shared view. A connected team. Care that keeps moving.</p><span className="small-caps">HERE WHEN IT MATTERS</span></div><button className="nav-item" onClick={() => openModal({ type: 'about' })}><CircleHelp size={18} /><span>About this view</span></button><div className="profile"><span className="avatar profile-avatar" aria-hidden="true">{myInitials}</span><div><strong>{me.displayName}</strong><span>Charge nurse · Signed in</span></div></div><button className="nav-item sign-out-item" onClick={onSignOut}><LogOut size={18} /><span>Sign out</span></button></div></aside>
    <div className="workspace-main"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileMenu(true)}><Menu size={21} /></button><span>Workspace</span><ChevronRight size={13} /><strong>{page}</strong></div><div className="topbar-right"><span className="demo-label"><span /> Synthetic data</span><span className="topbar-divider" /><button className="icon-button" aria-label="Refresh" title="Refresh" onClick={() => load()}><RefreshCw size={17} /></button><button className="icon-button notification-button" aria-label={`View urgent nurse updates (${urgentUpdates.length})`} onClick={() => (urgentUpdates[0] ? openUpdate(urgentUpdates[0]) : openModal({ type: 'all-updates' }))}><Bell size={18} />{urgentUpdates.length > 0 && <i />}</button><span className="avatar top-avatar" title={me.displayName} aria-hidden="true">{myInitials}</span><button className="icon-button" aria-label="Sign out" title="Sign out" onClick={onSignOut}><LogOut size={17} /></button></div></header>
      <main><div className="incident-banner"><span className="incident-icon"><Activity size={17} /></span><strong>{incident.type ?? 'Incident'}</strong><Badge tone={incidentActive ? 'amber' : 'neutral'}>{incidentActive ? 'Incident active' : 'Incident closed'}</Badge><span className="incident-description">{incidentActive ? 'Downtime coordination is in progress' : 'Normal services have resumed'}</span><div className="incident-time"><Clock3 size={14} /><strong>{Math.floor(elapsed / 60)}h {String(elapsed % 60).padStart(2, '0')}m</strong><span>{incidentActive ? 'elapsed' : 'total'}</span></div></div>
        {refreshFailed && <div className="notice amber-notice" role="status"><TriangleAlert size={16} /> Couldn't refresh from CareBridge. Showing data from {lastLoadedAt ? `${formatTime(lastLoadedAt)} Pacific` : 'the last load'}. <button className="text-button" onClick={() => load()}>Try again</button></div>}
        <section className="page-heading"><div><div className="eyebrow">{String(incident.unit ?? '').toUpperCase()}</div><h1>{pageTitle}</h1><p>{pageLead}</p></div><button className="secondary-button handoff-button" onClick={() => openModal({ type: 'handoff' })}><FileText size={16} /> Handoff preview <ArrowUpRight size={14} /></button></section>
        {(page === 'Overview' || page === 'Patients') && <div className="stats-grid"><button className="stat-card" onClick={() => { go('Patients'); setFilter('All patients'); }}><span className="stat-label">Active patients <HeartPulse size={18} /></span><div className="stat-value">{patients.length}<span>in this incident</span></div><span className="stat-description">{unverified.length} need verification <ArrowUpRight size={13} /></span></button><button className="stat-card urgent-stat" onClick={() => { go('Patients'); setFilter('High priority'); }}><span className="stat-label">High priority <TriangleAlert size={18} /></span><div className="stat-value">{patients.filter((p) => p.priority === 'High').length}<span>need your attention</span></div><span className="stat-description red-text">Review urgent concerns <ArrowRight size={13} /></span></button><button className="stat-card" onClick={() => { go('Tasks'); setTaskFilter('Overdue'); }}><span className="stat-label">Open tasks <ClipboardList size={18} /></span><div className="stat-value">{openTasks.length}<span><span className="amber-text">{overdue.length} overdue</span></span></div><span className="stat-description">{unconfirmed.length} awaiting confirmation <ArrowUpRight size={13} /></span></button><button className="stat-card" onClick={() => openModal({ type: 'all-updates' })}><span className="stat-label">Urgent updates <Bell size={18} /></span><div className="stat-value">{urgentUpdates.length}<span>of {updates.length} updates</span></div><span className="stat-description">Read original updates <ArrowUpRight size={13} /></span></button></div>}
        {(page === 'Overview' || page === 'Patients' || page === 'Tasks') && <div className="section-toolbar"><div className="section-context"><span className="live-dot" /> {page === 'Tasks' ? 'Task board' : 'Unit overview'}<span className="muted small-text">{lastLoadedAt ? `Updated ${formatTime(lastLoadedAt)} Pacific` : ''}</span></div><label className="search-field"><Search size={16} /><input aria-label={page === 'Tasks' ? 'Search tasks, patients, or nurses' : 'Search patients, rooms, or nurses'} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={page === 'Tasks' ? 'Search tasks, patients, nurses…' : 'Search patients, rooms, nurses…'} />{search && <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label></div>}
        {page === 'Overview' && <div className="overview-grid"><div className="main-column">{patientTable}{reviewPanel}</div><aside className="right-column"><section className="panel updates-panel"><div className="panel-heading"><h2>Latest updates</h2><span className="subtle-icon"><Activity size={17} /></span></div><div className="update-feed">{updates.slice(0, 4).map((u) => <button className="update-item" key={u.id} onClick={() => openUpdate(u)}><div className="update-topline"><Avatar person={personFor(u.nurse)} small /><strong>{nameOf(u.nurse)}</strong><time>{minutesSince(u.createdAt, now)}m ago</time></div><div className="update-body"><div className="update-patient">Room {roomOf(u.patient)}<span>·</span>{shortName(patientName(u.patient))}</div><p>{u.text}</p><div className="update-labels">{u.urgent ? <Badge tone="red">Urgent</Badge> : <Badge>{u.category}</Badge>}{u.processing === 'failed' && <span className="processing-note">AI unavailable · update kept</span>}{u.editHistory?.length > 0 && <span className="processing-note">Corrected</span>}</div></div></button>)}{!updates.length && <div className="empty-state"><FileText size={22} /><p>No nurse updates yet.</p></div>}</div><button className="panel-bottom-link" onClick={() => openModal({ type: 'all-updates' })}>View all {updates.length} updates <ArrowRight size={14} /></button></section>{supplyUpdate && <section className="supply-card"><div className="supply-icon"><ClipboardCheck size={18} /></div><div><h3>A heads-up on supplies</h3><p>{supplyUpdate.text}</p><button className="text-button" onClick={() => openUpdate(supplyUpdate)}>Review concern <ArrowRight size={13} /></button></div></section>}<div className="team-mini"><div className="avatar-stack">{nurses.slice(0, 4).map((n) => <Avatar key={n.id} person={n} small />)}</div><span><strong>{nurses.length} nurses</strong> with assignments</span><button className="icon-button" aria-label="View care team" onClick={() => go('Care team')}><ArrowRight size={15} /></button></div></aside></div>}
        {page === 'Patients' && patientTable}
        {page === 'Tasks' && <section className="panel"><div className="panel-heading"><div><h2>Tasks <span className="count">{tasks.length}</span></h2><p>Select a task to reassign it, change its priority or due time, or update its status.</p></div><div className="task-filters"><label className="sr-only" htmlFor="task-status">Filter tasks by status</label><select id="task-status" value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}>{TASK_FILTERS.map((s) => <option key={s}>{s}</option>)}</select><label className="sr-only" htmlFor="task-sort">Sort tasks</label><select id="task-sort" value={taskSort} onChange={(event) => setTaskSort(event.target.value)}><option value="due">Sort: due time</option><option value="priority">Sort: priority</option><option value="patient">Sort: patient</option></select></div></div><div className="task-list">{filteredTasks.map((task) => { const late = isTaskOverdue(task, now); return <button className="task-row" key={task.id} onClick={() => openTask(task)}><span className="task-icon"><ClipboardList size={19} /></span><span className="task-description"><strong>{task.description}</strong><small>Room {roomOf(task.patient)} · {patientName(task.patient)} · {nameOf(task.nurse)}</small></span><Priority value={task.priority} /><span className="task-time"><strong className={late ? 'red-text' : ''}>{!task.dueAt ? 'No due time' : late ? `${minutesSince(task.dueAt, now)}m overdue` : `Due ${formatTime(task.dueAt)}`}</strong><small>{task.status}</small></span><ChevronRight size={16} /></button>; })}{!filteredTasks.length && <div className="empty-state"><ClipboardCheck size={25} /><h3>No matching tasks</h3><p>Try a different search or status.</p></div>}</div></section>}
        {page === 'Care team' && <><div className="team-grid">{nurses.map((nurse) => { const mine = patients.filter((p) => p.nurse === nurse.id); const theirOpen = openTasks.filter((t) => t.nurse === nurse.id); const theirLate = overdue.filter((t) => t.nurse === nurse.id); return <section className="panel team-card" key={nurse.id}><Avatar person={nurse} /><h2>{nurse.name}</h2><p>Registered nurse</p><Badge tone={theirLate.length ? 'red' : theirOpen.length ? 'teal' : 'green'}>{theirLate.length ? `${theirLate.length} overdue` : theirOpen.length ? `${theirOpen.length} open task${theirOpen.length === 1 ? '' : 's'}` : 'No open tasks'}</Badge><div className="team-card-footer"><span>{mine.length} patient{mine.length === 1 ? '' : 's'} assigned</span><button className="text-button" onClick={() => { go('Patients'); setNurseFilter(nurse.id); setFilter('All patients'); setShowFilters(true); }}>View patients <ArrowRight size={13} /></button></div></section>; })}</div>{!nurses.length && <div className="empty-state"><Users size={22} /><p>No nurses have assignments in this incident yet.</p></div>}<p className="page-note">Shows nurses with patients, tasks, or updates in this incident. Availability, breaks, and staffing gaps are not tracked in CareBridge yet.</p></>}
        {page === 'AI review' && <>{reviewPanel}{decided.length > 0 && <section className="panel" style={{ marginTop: 20 }}><div className="panel-heading"><div><h2>Decided <span className="count">{decided.length}</span></h2><p>Approved and rejected recommendations, with who decided.</p></div></div><div className="task-list">{decided.map((rec) => <button className="task-row" key={rec.id} onClick={() => openReview(rec)}><span className="task-icon"><Sparkles size={19} /></span><span className="task-description"><strong>{rec.title}</strong><small>Room {roomOf(rec.patient)} · {rec.status} by {nameOf(rec.decidedBy)}{rec.decidedAt ? ` at ${formatTime(rec.decidedAt)} Pacific` : ''}</small></span><Badge tone={rec.status === 'approved' ? 'green' : 'neutral'}>{rec.status}</Badge><ChevronRight size={16} /></button>)}</div></section>}<div className="notice wide-notice"><ShieldCheck size={19} /><span>Recommendations come from the AI review step: Amazon Bedrock with a Guardrail when the backend runs in live mode, otherwise a labeled synthetic stub. Approval is enforced by the CareBridge API; a recommendation never changes patients or tasks on its own.</span></div></>}
        {page === 'Policy assistant' && <PolicyAssistant api={api} onAuthError={handleAuthError} />}
        <footer className="page-footer"><span><span className="brand-mini"><Plus size={12} strokeWidth={3} /></span> CareBridge <span>·</span> Continuity of care, together.</span><span>Synthetic data <span>·</span> Times in Pacific</span></footer>
      </main>
    </div>
    <dialog ref={dialog} className="detail-dialog" onCancel={() => setModal(null)} onClick={(event) => { if (event.target === dialog.current) setModal(null); }} aria-label="CareBridge details"><div className="dialog-content"><button className="icon-button modal-close" aria-label="Close details" onClick={() => setModal(null)} autoFocus><X size={21} /></button>{renderModal()}</div></dialog>
  </div>;
}
