#!/usr/bin/env node
// Administrator tool: bind a Cognito account to an existing CareBridge
// application user (e.g. n1), or remove that binding.
//
// The Cognito sub and group membership are read from Cognito with the
// administrator's AWS credentials; nothing is accepted from a browser and
// accounts are never matched by display name. Prints no tokens or passwords.
//
// Bind (deployed):
//   AWS_REGION=us-east-1 TABLE_NAME=CareBridge-dev node scripts/provision-identity.js \
//     --user-pool-id us-east-1_EXAMPLE --username nurse.one@example.org \
//     --app-user-id n1 --role nurse --display-name "Sarah Chen"
//
// Remove (deployed):
//   ... node scripts/provision-identity.js --remove \
//     --user-pool-id us-east-1_EXAMPLE --username nurse.one@example.org
//
// Local only (DYNAMODB_ENDPOINT set): --sub <uuid> may replace the Cognito
// lookup so DynamoDB Local can be exercised without a user pool.

import { parseArgs } from 'node:util';
import { userInfo } from 'node:os';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient, AdminGetUserCommand, AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { planIdentityBinding, planIdentityRemoval, ProvisioningError } from './lib/provisioning.js';
import { identityKey } from '../src/lib/keys.js';

const USAGE = `Usage:
  node scripts/provision-identity.js --user-pool-id <id> --username <email>
       --app-user-id <n1|c1|...> --role <nurse|charge_nurse> [--display-name <name>]
       [--allow-role-change] [--table <name>] [--region <region>]
  node scripts/provision-identity.js --remove --user-pool-id <id> --username <email>
  Local DynamoDB only: replace --user-pool-id/--username with --sub <uuid>.

Environment: TABLE_NAME, AWS_REGION, DYNAMODB_ENDPOINT (local only).`;

const { values: args } = parseArgs({
  options: {
    'user-pool-id': { type: 'string' },
    username: { type: 'string' },
    sub: { type: 'string' },
    'app-user-id': { type: 'string' },
    role: { type: 'string' },
    'display-name': { type: 'string' },
    table: { type: 'string' },
    region: { type: 'string' },
    'allow-role-change': { type: 'boolean', default: false },
    remove: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

function regionFromPoolId(poolId) {
  const match = /^([a-z]{2}(?:-[a-z]+)+-\d+)_/.exec(poolId ?? '');
  return match?.[1];
}

async function resolveCognitoUser({ poolId, username, region }) {
  const cognito = new CognitoIdentityProviderClient({ region });
  const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: username }));
  const sub = user.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
  if (!sub) fail('Cognito did not return a sub for this user.');
  if (user.Enabled === false) fail('This Cognito user is disabled. Enable it before binding.');

  const groups = [];
  let NextToken;
  do {
    const page = await cognito.send(new AdminListGroupsForUserCommand({
      UserPoolId: poolId, Username: username, NextToken,
    }));
    groups.push(...(page.Groups ?? []).map((g) => g.GroupName));
    NextToken = page.NextToken;
  } while (NextToken);

  return { sub, groups, status: user.UserStatus };
}

function explainCancellation(err, remove) {
  const reasons = (err.CancellationReasons ?? []).map((r) => r?.Code);
  if (remove) return 'The mapping and profile no longer agree; inspect both items before retrying.';
  if (reasons[0] === 'ConditionalCheckFailed') {
    return 'This Cognito account is already mapped to a different application user. Remove that mapping first (--remove).';
  }
  if (reasons[1] === 'ConditionalCheckFailed') {
    return 'The application user is bound to a different Cognito account, or its recorded role differs. '
      + 'Remove the other binding first, or pass --allow-role-change after moving the Cognito group.';
  }
  return 'The transaction was cancelled; no changes were made.';
}

async function main() {
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const local = Boolean(process.env.DYNAMODB_ENDPOINT);
  const tableName = args.table || process.env.TABLE_NAME;
  if (!tableName) fail(`Set TABLE_NAME or pass --table.\n\n${USAGE}`);
  const region = args.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION
    || regionFromPoolId(args['user-pool-id']) || (local ? 'us-east-1' : undefined);
  if (!region) fail('Set AWS_REGION or pass --region.');

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(local
    ? {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      region,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }
    : { region }));

  let sub;
  let groups;
  let label;
  if (args.sub) {
    if (!local) fail('--sub is only accepted with DYNAMODB_ENDPOINT (local testing). Use --user-pool-id and --username.');
    sub = args.sub;
    label = `sub ${sub}`;
  } else {
    if (!args['user-pool-id'] || !args.username) fail(`--user-pool-id and --username are required.\n\n${USAGE}`);
    const found = await resolveCognitoUser({ poolId: args['user-pool-id'], username: args.username, region });
    sub = found.sub;
    groups = found.groups;
    label = `${args.username} (status ${found.status})`;
  }

  try {
    if (args.remove) {
      const mapping = await ddb.send(new GetCommand({ TableName: tableName, Key: identityKey(sub), ConsistentRead: true }));
      if (!mapping.Item) {
        console.log(`No CareBridge mapping exists for ${label}. Nothing to remove.`);
        return;
      }
      const plan = planIdentityRemoval({ tableName, cognitoSub: sub, appUserId: mapping.Item.userId });
      await ddb.send(new TransactWriteCommand(plan));
      console.log(`Removed mapping for ${label} from application user ${mapping.Item.userId}. API access is blocked immediately.`);
      return;
    }

    const plan = planIdentityBinding({
      tableName,
      cognitoSub: sub,
      appUserId: args['app-user-id'],
      role: args.role,
      cognitoGroups: groups,
      displayName: args['display-name'],
      provisionedBy: `admin:${userInfo().username}`,
      allowRoleChange: args['allow-role-change'],
    });
    await ddb.send(new TransactWriteCommand(plan));
    console.log(`Bound ${label} to application user ${args['app-user-id']} as ${args.role}.`);
  } catch (err) {
    if (err instanceof ProvisioningError) fail(err.message);
    if (err.name === 'TransactionCanceledException') fail(explainCancellation(err, args.remove));
    throw err;
  }
}

main().catch((err) => {
  // Error names and messages from the AWS SDK do not include credentials.
  console.error('Provisioning failed:', err.name, err.message);
  process.exit(1);
});
