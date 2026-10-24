/**
 * Priority queue — the heart of the charge nurse dashboard.
 *
 * For each pending recommendation (ranked by urgency) the charge nurse can:
 *   1. Open the original nurse update (verbatim, clearly separated from AI)
 *   2. View the Bedrock-generated handoff summary
 *   3. See risks and recommended action
 *   4. See the evidence update IDs
 *   5. Approve / reject / modify the recommendation
 *   6. Assign the resulting task to a nurse
 *
 * AI content is always labeled and never presented as confirmed clinical fact.
 */

import { useState } from 'react';
import type { Decision } from '../api/dashboardData.ts';
import type { Nurse, QueueItem } from '../types.ts';
import {
  AiGeneratedBadge,
  BedrockUnavailableBadge,
  RequiresReviewBadge,
  StatusBadge,
  UrgencyBadge,
} from './Badges.tsx';

interface Props {
  queue: QueueItem[];
  nurses: Nurse[];
  onDecide: (recId: string, decision: Decision, description?: string, assignee?: string) => void;
  onAssign: (taskId: string, assignee: string) => void;
  taskForRec: (recId: string) => { taskId: string; assignee: string } | undefined;
}

function rankOf(urgency: QueueItem['analysis']['urgency']): number {
  return { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 }[urgency];
}

export function PriorityQueue({ queue, nurses, onDecide, onAssign, taskForRec }: Props): JSX.Element {
  const ordered = [...queue].sort(
    (a, b) => rankOf(a.analysis.urgency) - rankOf(b.analysis.urgency),
  );

  if (ordered.length === 0) {
    return <p className="muted">No AI recommendations pending review.</p>;
  }

  return (
    <div className="queue">
      {ordered.map((item) => (
        <QueueCard
          key={item.recommendation.recId}
          item={item}
          nurses={nurses}
          onDecide={onDecide}
          onAssign={onAssign}
          task={taskForRec(item.recommendation.recId)}
        />
      ))}
    </div>
  );
}

function QueueCard({
  item,
  nurses,
  onDecide,
  onAssign,
  task,
}: {
  item: QueueItem;
  nurses: Nurse[];
  onDecide: Props['onDecide'];
  onAssign: Props['onAssign'];
  task: { taskId: string; assignee: string } | undefined;
}): JSX.Element {
  const { recommendation: rec, analysis, update, patient } = item;
  const [showOriginal, setShowOriginal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rec.content.description);
  const [assignee, setAssignee] = useState(
    rec.content.suggestedAssignee ?? nurses.find((n) => n.available)?.name ?? '',
  );

  const pending = rec.status === 'pending';

  return (
    <article className={`card urgency-${analysis.urgency.toLowerCase()}`}>
      <header className="card-head">
        <div>
          <span className="patient">{patient.name}</span>
          <span className="room"> · Room {patient.room}</span>
        </div>
        <div className="badges">
          <UrgencyBadge level={analysis.urgency} />
          <StatusBadge status={rec.status} />
          {item.aiUnavailable ? <BedrockUnavailableBadge /> : null}
        </div>
      </header>

      {item.aiUnavailable ? (
        <p className="ai-unavailable-note">
          AI processing was unavailable for this update. The original nurse update is preserved
          below; triage manually.
        </p>
      ) : null}

      {/* AI-generated block — explicitly labeled, framed as advisory. */}
      <section className="ai-block">
        <div className="ai-block-head">
          <AiGeneratedBadge />
          {pending ? <RequiresReviewBadge /> : null}
          <span className="confidence">confidence {Math.round(analysis.confidence * 100)}%</span>
        </div>
        <p className="disclaimer">
          AI-generated draft for human review. Not a diagnosis or confirmed clinical fact.
        </p>

        <h4>Handoff summary</h4>
        <p>{analysis.handoff_summary}</p>

        <h4>Risks</h4>
        <ul>
          {analysis.risks.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>

        <h4>Recommended action</h4>
        {editing ? (
          <textarea
            className="edit-action"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
          />
        ) : (
          <p>{rec.modifiedContent?.description ?? rec.content.description}</p>
        )}

        <h4>Recommended follow-up</h4>
        <ul>
          {analysis.recommended_follow_up.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>

        <div className="evidence">
          Evidence update IDs:{' '}
          {analysis.evidence_update_ids.map((id) => (
            <code key={id}>{id}</code>
          ))}
        </div>
      </section>

      {/* Original nurse update — verbatim, separated from AI content. */}
      <section className="original-block">
        <button className="link" onClick={() => setShowOriginal((s) => !s)}>
          {showOriginal ? 'Hide' : 'Open'} original nurse update
        </button>
        {showOriginal ? (
          <blockquote className="original">
            <div className="original-meta">
              {update.authorName} ({update.authorRole}) ·{' '}
              {new Date(update.createdAt).toLocaleString()}
            </div>
            {update.text}
          </blockquote>
        ) : null}
      </section>

      {/* Decision + assignment controls. */}
      {pending ? (
        <footer className="actions">
          <label className="assign">
            Assign to{' '}
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              {nurses.map((n) => (
                <option key={n.nurseId} value={n.name} disabled={!n.available}>
                  {n.name}
                  {n.available ? '' : ' (unavailable)'}
                </option>
              ))}
            </select>
          </label>
          <div className="buttons">
            {editing ? (
              <>
                <button
                  className="btn btn-approve"
                  onClick={() => {
                    onDecide(rec.recId, 'modify-approve', draft, assignee);
                    setEditing(false);
                  }}
                >
                  Save &amp; approve
                </button>
                <button className="btn" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn btn-approve"
                  onClick={() => onDecide(rec.recId, 'approve', undefined, assignee)}
                >
                  Approve
                </button>
                <button className="btn" onClick={() => setEditing(true)}>
                  Modify
                </button>
                <button className="btn btn-reject" onClick={() => onDecide(rec.recId, 'reject')}>
                  Reject
                </button>
              </>
            )}
          </div>
        </footer>
      ) : rec.status === 'approved' && task ? (
        <footer className="actions resolved">
          <span>
            Task created, assigned to <strong>{task.assignee}</strong>.
          </span>
          <label className="assign">
            Reassign{' '}
            <select
              value={task.assignee}
              onChange={(e) => onAssign(task.taskId, e.target.value)}
            >
              {nurses.map((n) => (
                <option key={n.nurseId} value={n.name} disabled={!n.available}>
                  {n.name}
                  {n.available ? '' : ' (unavailable)'}
                </option>
              ))}
            </select>
          </label>
        </footer>
      ) : (
        <footer className="actions resolved">
          <span>Recommendation {rec.status}. No task created.</span>
        </footer>
      )}
    </article>
  );
}
