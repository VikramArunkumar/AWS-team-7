// DynamoDB Document client shared across handlers.
//
// Honors a DYNAMODB_ENDPOINT override so the same code runs against
// DynamoDB Local during development and real DynamoDB in AWS.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const endpoint = process.env.DYNAMODB_ENDPOINT || undefined;

const baseClient = new DynamoDBClient({
  ...(endpoint ? { endpoint } : {}),
  // Local DynamoDB ignores credentials but the SDK still requires some to be set.
  ...(endpoint
    ? {
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
        },
      }
    : {}),
});

export const ddb = DynamoDBDocumentClient.from(baseClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

export const TABLE_NAME = process.env.TABLE_NAME || 'CareBridge-dev';
