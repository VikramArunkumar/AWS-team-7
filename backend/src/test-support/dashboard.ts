/**
 * Pure dashboard metric helpers, mirroring the rules used by the frontend
 * SummaryPanels (overdue = not done AND dueAt in the past; unresolved = not
 * done). Kept here so the acceptance suite can verify scenario 9 (overdue tasks
 * appear on the dashboard) without a DOM test runner.
 */

export interface TaskLike {
  status: 'open' | 'in-progress' | 'done';
  dueAt?: string;
}

export interface DashboardCounts {
  unresolvedTasks: number;
  overdueTasks: number;
}

export function buildDashboardCounts(data: { tasks: TaskLike[] }): DashboardCounts {
  const now = Date.now();
  const unresolvedTasks = data.tasks.filter((t) => t.status !== 'done').length;
  const overdueTasks = data.tasks.filter(
    (t) => t.status !== 'done' && t.dueAt && new Date(t.dueAt).getTime() < now,
  ).length;
  return { unresolvedTasks, overdueTasks };
}
