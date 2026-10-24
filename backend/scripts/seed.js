// Seed DynamoDB Local with the frontend's synthetic fixtures.
//
// Reads the existing demo data from ../../src/data.js so the seeded database
// matches what the UI already renders, then writes it into the single table
// using the same key schema the handlers use. Synthetic data only (NFR-10).
//
// Usage (with DynamoDB Local running on :8000 and the table created):
//   node scripts/seed.js
//
// Env:
//   DYNAMODB_ENDPOINT (default http://127.0.0.1:8000)
//   TABLE_NAME        (default CareBridge-dev)

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENDPOINT = process.env.DYNAMODB_ENDPOINT || 'http://127.0.0.1:8000';
const TABLE_NAME = process.env.TABLE_NAME || 'CareBridge-dev';

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    endpoint: ENDPOINT,
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

const pk = (incidentId) => `INCIDENT#${incidentId}`;

async function main() {
  // Import the frontend fixtures directly so seed data never drifts from the UI.
  const dataUrl = pathToFileURL(resolve(__dirname, '../../src/data.js')).href;
  const {
    incident, patients, updates, tasks, recommendations,
  } = await import(dataUrl);

  const incidentId = incident.id;
  const items = [];

  // Incident META
  items.push({
    PK: pk(incidentId), SK: 'META', entity: 'INCIDENT', incidentId,
    type: incident.type, unit: incident.unit, status: 'active',
    startedAt: incident.startedAt, endedAt: null, activatedBy: 'seed',
  });

  // Patients
  for (const p of patients) {
    items.push({
      PK: pk(incidentId), SK: `PATIENT#${p.id}`, entity: 'PATIENT', incidentId,
      id: p.id, name: p.name, age: p.age, room: p.room, nurse: p.nurse,
      priority: p.priority, concern: p.concern, detail: p.detail,
      verifiedAt: p.verifiedAt ?? null, note: p.note, source: p.source,
    });
  }

  // Nurse updates (original source text preserved)
  for (const u of updates) {
    items.push({
      PK: pk(incidentId), SK: `UPDATE#${u.id}`, entity: 'UPDATE', incidentId,
      id: u.id, patient: u.patient, nurse: u.nurse, createdAt: u.createdAt,
      urgent: Boolean(u.urgent), category: u.category, text: u.text,
      structured: null, editHistory: [],
      processing: u.processing?.includes('failed') ? 'failed'
        : u.processing?.includes('available') ? 'processed' : 'not_processed',
    });
  }

  // Tasks (with GSI1 for nurse-scoped lookups)
  for (const t of tasks) {
    items.push({
      PK: pk(incidentId), SK: `TASK#${t.id}`,
      GSI1PK: `INCIDENT#${incidentId}#NURSE#${t.nurse}`, GSI1SK: `TASK#${t.id}`,
      entity: 'TASK', incidentId, id: t.id, patient: t.patient,
      description: t.description, priority: t.priority, nurse: t.nurse,
      dueAt: t.dueAt, status: t.status, creator: t.creator, createdAt: t.createdAt,
    });
  }

  // AI recommendations (proposed, pending human decision)
  for (const r of recommendations) {
    items.push({
      PK: pk(incidentId), SK: `REC#${r.id}`, entity: 'REC', incidentId,
      id: r.id, patient: r.patient, title: r.title, reason: r.reason,
      sourceUpdateIds: [r.source], aiGenerated: true, status: 'proposed',
      createdAt: new Date().toISOString(),
    });
  }

  await batchWrite(items);
  console.log(`Seeded ${items.length} items into ${TABLE_NAME} (incident ${incidentId}).`);
}

async function batchWrite(items) {
  // BatchWrite handles 25 items per call.
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({
      RequestItems: { [TABLE_NAME]: chunk.map((Item) => ({ PutRequest: { Item } })) },
    }));
  }
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
