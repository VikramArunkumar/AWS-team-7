/**
 * Charge nurse dashboard (Phase 4, tasks 4.3/4.4).
 *
 * Composes the outage banner, headline metrics, and the priority queue where
 * the charge nurse reviews AI recommendations and approves / rejects / modifies
 * them, then assigns the resulting task. AI output is labeled throughout and is
 * never presented as confirmed clinical fact.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  assignTask,
  decide,
  loadDashboard,
  resetDemo,
  type Decision,
} from './api/dashboardData.ts';
import { OutageBanner, SummaryPanels } from './components/SummaryPanels.tsx';
import { PriorityQueue } from './components/PriorityQueue.tsx';
import { AuditHistory } from './components/AuditHistory.tsx';
import type { DashboardData } from './types.ts';

// NOTE: The policy assistant is DEFERRED (non-essential for the core
// end-to-end MVP path). The component and backend handler remain in the
// repo but are intentionally not mounted. See docs/DEFERRED.md.

export default function App(): JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh(): Promise<void> {
    setLoading(true);
    setData(await loadDashboard());
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const taskForRec = useMemo(() => {
    const map = new Map((data?.tasks ?? []).filter((t) => t.recId).map((t) => [t.recId!, t]));
    return (recId: string) => {
      const t = map.get(recId);
      return t ? { taskId: t.taskId, assignee: t.assignee } : undefined;
    };
  }, [data]);

  async function onDecide(
    recId: string,
    decision: Decision,
    description?: string,
    assignee?: string,
  ): Promise<void> {
    if (decision === 'reject') {
      await decide(recId, 'reject');
      await refresh();
      return;
    }

    // Approve and modify-approve both create a task; carry the chosen assignee
    // and (for modify) the edited description onto the applied content.
    const original = data?.queue.find((q) => q.recommendation.recId === recId)?.recommendation
      .content.description;
    await decide(recId, 'modify-approve', {
      description: decision === 'modify-approve' ? (description ?? '') : (original ?? ''),
      suggestedAssignee: assignee,
    });
    await refresh();
  }

  async function onAssign(taskId: string, assignee: string): Promise<void> {
    await assignTask(taskId, assignee);
    await refresh();
  }

  if (loading || !data) {
    return <main className="app"><p className="muted">Loading dashboard…</p></main>;
  }

  return (
    <main className="app">
      <header className="app-head">
        <h1>CareBridge — Charge Nurse Dashboard</h1>
        <button
          className="btn"
          onClick={async () => {
            await resetDemo();
            await refresh();
          }}
        >
          Reset demo
        </button>
      </header>

      <OutageBanner data={data} />
      <SummaryPanels data={data} />

      <section>
        <h2>Priority queue</h2>
        <p className="muted">
          AI recommendations ranked by urgency. Every item requires human review before any
          action. Approving creates a task; rejecting creates none.
        </p>
        <PriorityQueue
          queue={data.queue}
          nurses={data.nurses}
          onDecide={onDecide}
          onAssign={onAssign}
          taskForRec={taskForRec}
        />
      </section>

      <section>
        <h2>Staffing</h2>
        <ul className="staffing">
          {data.nurses.map((n) => (
            <li key={n.nurseId}>
              {n.name} — {n.available ? 'available' : 'unavailable'} · {n.activePatients} patients
            </li>
          ))}
        </ul>
        {data.staffingGaps.map((g, i) => (
          <p key={i} className="gap">
            Staffing gap in {g.area}: need {g.needed}, have {g.available}.
          </p>
        ))}
      </section>

      <AuditHistory entries={data.audit} />
    </main>
  );
}
