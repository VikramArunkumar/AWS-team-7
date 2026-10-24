// Create the single CareBridge table in DynamoDB Local with the same key
// schema and GSI1 as template.yaml. Idempotent: skips if the table exists.
//
// Usage: node scripts/create-local-table.js
// Env:   DYNAMODB_ENDPOINT (default http://127.0.0.1:8000), TABLE_NAME (default CareBridge-dev)

import {
  DynamoDBClient, CreateTableCommand, DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';

const ENDPOINT = process.env.DYNAMODB_ENDPOINT || 'http://127.0.0.1:8000';
const TABLE_NAME = process.env.TABLE_NAME || 'CareBridge-dev';

const client = new DynamoDBClient({
  endpoint: ENDPOINT,
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

async function main() {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    console.log(`Table ${TABLE_NAME} already exists.`);
    return;
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
  }

  await client.send(new CreateTableCommand({
    TableName: TABLE_NAME,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'GSI1PK', AttributeType: 'S' },
      { AttributeName: 'GSI1SK', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI1',
        KeySchema: [
          { AttributeName: 'GSI1PK', KeyType: 'HASH' },
          { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  }));
  console.log(`Created table ${TABLE_NAME}.`);
}

main().catch((err) => {
  console.error('Create table failed:', err.message);
  process.exit(1);
});
