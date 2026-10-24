// Seed DynamoDB Local with the frontend's synthetic fixtures.
//
// Reads the existing demo data from ../../src/data.js so the seeded database
// matches what the UI already renders, then writes it into the single table
// using the same key schema the handlers use. Synthetic data only (NFR-10).
//
// Application user profiles (USER#n1 ... USER#c1) are created only if absent,
// so re-seeding never removes a Cognito binding made by provision-identity.js.
//
// Usage (with DynamoDB Local running on :8000 and the table created):
//   node scripts/seed.js
//
// Deployed table (explicit opt-in; uses your AWS credentials and region):
//   AWS_REGION=us-east-1 TABLE_NAME=CareBridge-dev node scripts/seed.js --aws
// Incident items are overwritten, so run --aws once on a fresh table; rerunning
// resets the demo incident and discards later updates, tasks, and audit items.
//
// Env:
//   DYNAMODB_ENDPOINT (default http://127.0.0.1:8000; ignored with --aws)
//   TABLE_NAME        (default CareBridge-dev)

import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { buildSeedItems } from './lib/seed-items.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USE_AWS = process.argv.includes('--aws');
const ENDPOINT = process.env.DYNAMODB_ENDPOINT || 'http://127.0.0.1:8000';
const TABLE_NAME = process.env.TABLE_NAME || 'CareBridge-dev';

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient(USE_AWS
    ? { region: process.env.AWS_REGION || 'us-east-1' }
    : {
      endpoint: ENDPOINT,
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  { marshallOptions: { removeUndefinedValues: true } },
);

async function main() {
  // Import the frontend fixtures directly so seed data never drifts from the UI.
  const dataUrl = pathToFileURL(resolve(__dirname, '../../src/data.js')).href;
  const fixtures = await import(dataUrl);
  const { incidentItems, profileItems } = buildSeedItems(fixtures);

  await batchWrite(incidentItems);

  let createdProfiles = 0;
  for (const Item of profileItems) {
    try {
      await ddb.send(new PutCommand({
        TableName: TABLE_NAME, Item, ConditionExpression: 'attribute_not_exists(PK)',
      }));
      createdProfiles += 1;
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    }
  }

  console.log(
    `Seeded ${incidentItems.length} incident items into ${TABLE_NAME} (incident ${fixtures.incident.id}); `
    + `created ${createdProfiles} of ${profileItems.length} user profiles (existing profiles kept).`,
  );
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
