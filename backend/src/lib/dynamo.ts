/**
 * CareBridge DynamoDB single-table access layer (task 2.1).
 *
 * One table `CareBridge` with PK/SK and one GSI (GSI1PK/GSI1SK), matching
 * `.kiro/specs/carebridge-mvp/design.md`. This module owns:
 *  - the DynamoDB Document client,
 *  - ULID-based key builders (time-ordered sort keys),
 *  - typed put/query helpers for the documented access patterns.
 *
 * It deliberately exposes no update-in-place helper for UPDATE# items: nurse
 * updates are write-once and must never be overwritten.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';

const TABLE_NAME = process.env.TABLE_NAME ?? 'CareBridge';
const GSI1 = 'GSI1';

let docClient: DynamoDBDocumentClient | undefined;

/** Lazily created, reused across warm invocations. */
export function getClient(): DynamoDBDocumentClient {
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}

/** Test seam: inject a mock document client. */
export function setClient(client: DynamoDBDocumentClient): void {
  docClient = client;
}

/** Monotonic, lexically sortable id (ULID). */
export function newId(): string {
  return ulid();
}

// ---------------------------------------------------------------------------
// Key builders — the single source of truth for primary/GSI keys.
// ---------------------------------------------------------------------------

export interface TableKey {
  PK: string;
  SK: string;
}

export interface Gsi1Key {
  GSI1PK: string;
  GSI1SK: string;
}

export const keys = {
  outage(): TableKey {
    return { PK: 'OUTAGE', SK: 'STATE' };
  },
  patient(patientId: string): TableKey {
    return { PK: `PATIENT#${patientId}`, SK: 'META' };
  },
  update(patientId: string, id: string): TableKey {
    return { PK: `PATIENT#${patientId}`, SK: `UPDATE#${id}` };
  },
  extraction(patientId: string, id: string): TableKey {
    return { PK: `PATIENT#${patientId}`, SK: `EXTRACTION#${id}` };
  },
  analysis(patientId: string, id: string): TableKey {
    return { PK: `PATIENT#${patientId}`, SK: `ANALYSIS#${id}` };
  },
  aiError(patientId: string, id: string): TableKey {
    return { PK: `PATIENT#${patientId}`, SK: `AIERROR#${id}` };
  },
  recommendation(recId: string): TableKey {
    return { PK: `REC#${recId}`, SK: 'META' };
  },
  task(taskId: string): TableKey {
    return { PK: `TASK#${taskId}`, SK: 'META' };
  },
  audit(id: string): TableKey {
    return { PK: 'AUDIT', SK: `ENTRY#${id}` };
  },
} as const;

export const gsi1 = {
  recByStatus(status: string, priorityRank: number, id: string): Gsi1Key {
    // Zero-pad the rank so lexical order matches numeric order (1 = highest).
    const rank = String(priorityRank).padStart(6, '0');
    return { GSI1PK: `REC_STATUS#${status}`, GSI1SK: `${rank}#${id}` };
  },
  taskByStatus(status: string, id: string): Gsi1Key {
    return { GSI1PK: `TASK_STATUS#${status}`, GSI1SK: id };
  },
  patientRoster(name: string): Gsi1Key {
    return { GSI1PK: 'PATIENT', GSI1SK: name };
  },
} as const;

// ---------------------------------------------------------------------------
// Item shape stored in the table. Domain fields live alongside the keys.
// ---------------------------------------------------------------------------

export type StoredItem = TableKey & Partial<Gsi1Key> & { [key: string]: unknown };

// ---------------------------------------------------------------------------
// Generic helpers.
// ---------------------------------------------------------------------------

/** Write an item (overwrites by PK/SK). Callers control whether this is safe. */
export async function putItem(item: StoredItem): Promise<void> {
  await getClient().send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

/**
 * Write an item only if it does not already exist (PK/SK must be unique).
 * Used for write-once records such as nurse updates. Throws if the item exists.
 */
export async function putItemIfAbsent(item: StoredItem): Promise<void> {
  await getClient().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    }),
  );
}

export async function getItem<T = StoredItem>(key: TableKey): Promise<T | undefined> {
  const res = await getClient().send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
  return res.Item as T | undefined;
}

/**
 * Query a partition by PK, optionally filtering the SK by a begins_with prefix.
 * `ascending` controls sort order (default true = chronological for ULID SKs).
 */
export async function queryByPrefix<T = StoredItem>(
  pk: string,
  skPrefix?: string,
  ascending = true,
): Promise<T[]> {
  const input: QueryCommandInput = {
    TableName: TABLE_NAME,
    ScanIndexForward: ascending,
    KeyConditionExpression: skPrefix
      ? 'PK = :pk AND begins_with(SK, :sk)'
      : 'PK = :pk',
    ExpressionAttributeValues: skPrefix ? { ':pk': pk, ':sk': skPrefix } : { ':pk': pk },
  };
  const res = await getClient().send(new QueryCommand(input));
  return (res.Items ?? []) as T[];
}

/** Query GSI1 by its partition key, ascending by GSI1SK. */
export async function queryGsi1<T = StoredItem>(
  gsi1pk: string,
  ascending = true,
): Promise<T[]> {
  const res = await getClient().send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1,
      ScanIndexForward: ascending,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': gsi1pk },
    }),
  );
  return (res.Items ?? []) as T[];
}

/** Low-level UpdateItem passthrough for records that are mutable (not updates). */
export async function updateItem(
  key: TableKey,
  updateExpression: string,
  values: Record<string, unknown>,
  names?: Record<string, string>,
): Promise<void> {
  await getClient().send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: values,
      ExpressionAttributeNames: names,
    }),
  );
}

export { TABLE_NAME };
