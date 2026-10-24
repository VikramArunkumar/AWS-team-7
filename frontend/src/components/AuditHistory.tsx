/**
 * Audit history panel — part of the core end-to-end path.
 *
 * Shows a reverse-chronological trail of consequential actions: outage changes,
 * AI recommendations generated, and the charge nurse's approve/reject/modify
 * decisions and resulting task assignments. This is the traceability record for
 * every human-approved action.
 */

import type { AuditEntry } from '../types.ts';

const LABELS: Record<string, string> = {
  'outage-activated': 'Outage activated',
  'outage-deactivated': 'Outage resolved',
  'recommendation-generated': 'AI recommendation generated',
  'recommendation-approved': 'Recommendation approved',
  'recommendation-rejected': 'Recommendation rejected',
  'recommendation-modified': 'Recommendation modified',
  'task-created': 'Task created',
  'task-assigned': 'Task assigned',
  'bedrock-called': 'Bedrock analysis run',
};

export function AuditHistory({ entries }: { entries: AuditEntry[] }): JSX.Element {
  const ordered = [...entries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <section>
      <h2>Audit history</h2>
      <p className="muted">
        Every consequential action is recorded, newest first. AI recommendations and the human
        decisions on them are fully traceable.
      </p>
      {ordered.length === 0 ? (
        <p className="muted">No audit entries yet.</p>
      ) : (
        <ol className="audit-log">
          {ordered.map((e) => (
            <li key={e.entryId} className="audit-entry">
              <span className="audit-time">{new Date(e.createdAt).toLocaleTimeString()}</span>
              <span className="audit-action">{LABELS[e.action] ?? e.action}</span>
              <span className="audit-meta">
                {e.actorName} ({e.actorRole}){e.targetId ? ` · ${e.targetId}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
