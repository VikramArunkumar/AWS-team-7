/**
 * Audit trail helper (shared; first used by the outage handler in task 2.3).
 *
 * Every consequential action writes an immutable audit entry. Entries live in
 * the AUDIT partition with a ULID sort key so they read back in reverse
 * chronological order (Capability 10).
 */

import { keys, newId, putItem, queryByPrefix, type StoredItem } from './dynamo.ts';
import type { Actor, AuditAction, AuditEntry } from './types.ts';

interface RecordAuditInput {
  actor: Actor;
  action: AuditAction;
  targetId?: string;
  before?: unknown;
  after?: unknown;
}

/** Write an audit entry and return it. */
export async function recordAudit(input: RecordAuditInput): Promise<AuditEntry> {
  const entryId = newId();
  const entry: AuditEntry = {
    entryId,
    actorRole: input.actor.role,
    actorName: input.actor.name,
    action: input.action,
    targetId: input.targetId,
    before: input.before,
    after: input.after,
    createdAt: new Date().toISOString(),
  };

  const item: StoredItem = { ...keys.audit(entryId), ...entry };
  await putItem(item);
  return entry;
}

/** List audit entries in reverse chronological order (newest first). */
export async function listAudit(): Promise<AuditEntry[]> {
  const items = await queryByPrefix<StoredItem & AuditEntry>('AUDIT', 'ENTRY#', false);
  return items.map(stripKeys);
}

function stripKeys(item: StoredItem & AuditEntry): AuditEntry {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, ...rest } = item;
  return rest as AuditEntry;
}
