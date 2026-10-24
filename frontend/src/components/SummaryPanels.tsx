/**
 * Top-of-dashboard summary: active outage + duration, and the headline metrics
 * (active patients, high-priority issues, urgent updates, unresolved tasks,
 * overdue tasks, unverified patient info, available nurses, staffing gaps).
 */

import type { DashboardData } from '../types.ts';

function formatDuration(startIso?: string): string {
  if (!startIso) return '—';
  const ms = Date.now() - new Date(startIso).getTime();
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }): JSX.Element {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function OutageBanner({ data }: { data: DashboardData }): JSX.Element {
  const { outage } = data;
  if (outage.status !== 'active') {
    return (
      <div className="outage-banner outage-normal">
        No active outage. Operating normally.
      </div>
    );
  }
  return (
    <div className="outage-banner outage-active" role="status">
      <div>
        <strong>ACTIVE OUTAGE — {outage.incidentType ?? 'EHR outage'}</strong>
        <div className="outage-sub">
          Duration {formatDuration(outage.startedAt)} · Affected:{' '}
          {(outage.affectedSystems ?? []).join(', ') || 'n/a'}
          {outage.note ? ` · ${outage.note}` : ''}
        </div>
      </div>
    </div>
  );
}

export function SummaryPanels({ data }: { data: DashboardData }): JSX.Element {
  const activePatients = data.patients.length;
  const highPriorityIssues = data.queue.filter(
    (q) => q.analysis.urgency === 'HIGH' || q.analysis.urgency === 'CRITICAL',
  ).length;
  const urgentUpdates = data.updates.filter((u) => u.urgent).length;
  const unresolvedTasks = data.tasks.filter((t) => t.status !== 'done').length;
  const overdueTasks = data.tasks.filter(
    (t) => t.status !== 'done' && t.dueAt && new Date(t.dueAt).getTime() < Date.now(),
  ).length;
  const unverified = data.patients.filter((p) => p.verified === false).length;
  const availableNurses = data.nurses.filter((n) => n.available).length;
  const staffingGaps = data.staffingGaps.reduce(
    (sum, g) => sum + Math.max(0, g.needed - g.available),
    0,
  );

  return (
    <div className="stats-grid">
      <Stat label="Active patients" value={activePatients} />
      <Stat label="High-priority issues" value={highPriorityIssues} tone="danger" />
      <Stat label="Urgent updates" value={urgentUpdates} tone="warn" />
      <Stat label="Unresolved tasks" value={unresolvedTasks} />
      <Stat label="Overdue tasks" value={overdueTasks} tone="danger" />
      <Stat label="Unverified patient info" value={unverified} tone="warn" />
      <Stat label="Available nurses" value={availableNurses} tone="ok" />
      <Stat label="Staffing gaps" value={staffingGaps} tone={staffingGaps > 0 ? 'danger' : 'ok'} />
    </div>
  );
}
