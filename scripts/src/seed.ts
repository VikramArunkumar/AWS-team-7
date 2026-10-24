/**
 * Seed / reset the CareBridge demo data in DynamoDB (and optionally upload the
 * synthetic policy documents to S3).
 *
 * Usage:
 *   TABLE_NAME=CareBridge node --experimental-strip-types scripts/src/seed.ts
 *   TABLE_NAME=CareBridge node --experimental-strip-types scripts/src/seed.ts --reset
 *   BUCKET_NAME=... node --experimental-strip-types scripts/src/seed.ts --with-policies
 *
 * --reset       delete existing demo records first, then re-seed (restore the
 *               original demo state before recording the hackathon video).
 * --with-policies  also upload data/policies/*.md to S3 under policies/.
 *
 * All data written is synthetic. Requires AWS credentials with access to the
 * table (and bucket, if uploading policies).
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDemoDataset } from './demoData.ts';

const TABLE_NAME = process.env.TABLE_NAME ?? 'CareBridge';
const BUCKET_NAME = process.env.BUCKET_NAME ?? '';
const args = new Set(process.argv.slice(2));
const RESET = args.has('--reset');
const WITH_POLICIES = args.has('--with-policies');

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

// Key builders — must match backend/src/lib/dynamo.ts.
const keys = {
  outage: () => ({ PK: 'OUTAGE', SK: 'STATE' }),
  patient: (id: string) => ({ PK: `PATIENT#${id}`, SK: 'META' }),
  update: (patientId: string, id: string) => ({ PK: `PATIENT#${patientId}`, SK: `UPDATE#${id}` }),
  task: (id: string) => ({ PK: `TASK#${id}`, SK: 'META' }),
};

async function put(item: Record<string, unknown>): Promise<void> {
  await doc.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

/** Delete all items in a partition (used by --reset for patient partitions). */
async function deletePartition(pk: string): Promise<void> {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
    }),
  );
  for (const item of res.Items ?? []) {
    await doc.send(
      new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: item.PK, SK: item.SK } }),
    );
  }
}

async function resetDemo(ds: ReturnType<typeof buildDemoDataset>): Promise<void> {
  console.log('[seed] --reset: removing existing demo records…');
  await deletePartition('OUTAGE');
  for (const p of ds.patients) await deletePartition(`PATIENT#${p.patientId}`);
  for (const t of ds.tasks) {
    await doc.send(
      new DeleteCommand({ TableName: TABLE_NAME, Key: keys.task(t.taskId) }),
    );
  }
}

async function uploadPolicies(): Promise<void> {
  if (!BUCKET_NAME) {
    console.warn('[seed] --with-policies set but BUCKET_NAME is empty; skipping upload.');
    return;
  }
  const s3 = new S3Client({});
  const dir = path.resolve(fileURLToPath(new URL('../../data/policies', import.meta.url)));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const body = await readFile(path.join(dir, file), 'utf8');
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `policies/${file}`,
        Body: body,
        ContentType: 'text/markdown',
      }),
    );
    console.log(`[seed] uploaded policies/${file}`);
  }
}

async function main(): Promise<void> {
  const ds = buildDemoDataset();
  console.log(`[seed] table=${TABLE_NAME} reset=${RESET} withPolicies=${WITH_POLICIES}`);

  if (RESET) await resetDemo(ds);

  // Outage
  await put({ ...keys.outage(), ...ds.outage });

  // Patients (+ store staffing/nurse roster on the outage-adjacent meta is not
  // modeled server-side yet; patients and updates/tasks are the persisted core).
  for (const p of ds.patients) {
    await put({ ...keys.patient(p.patientId), ...p });
  }

  // Updates (immutable raw records)
  for (const u of ds.updates) {
    await put({ ...keys.update(u.patientId, u.updateId), ...u });
  }

  // Tasks
  for (const t of ds.tasks) {
    await put({ ...keys.task(t.taskId), ...t, GSI1PK: `TASK_STATUS#${t.status}`, GSI1SK: t.taskId });
  }

  if (WITH_POLICIES) await uploadPolicies();

  console.log(
    `[seed] done: ${ds.patients.length} patients, ${ds.updates.length} updates, ` +
      `${ds.tasks.length} tasks, 1 active outage.`,
  );
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
