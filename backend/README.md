# CareBridge Backend

Serverless backend for CareBridge: AWS SAM (API Gateway REST API + Lambda) over a
single Amazon DynamoDB table, with Amazon Cognito sign-in. Node.js 22, ES modules.
**Synthetic patient data only.**

## Status

Implemented and verified locally (mocked claims, no live AWS):

- Cognito user pool with administrator-created accounts only, hosted login,
  authorization code grant with PKCE, a public SPA client with no secret, groups
  `nurse` and `charge_nurse`, and the `carebridge/access` resource-server scope
  (FR-1, FR-2, FR-4).
- An explicit REST API whose default Cognito authorizer protects every
  application route, including reads and `GET /me`, and requires the
  `carebridge/access` scope, so only access tokens are accepted. CORS preflight
  is unauthenticated (`AddDefaultAuthorizerToCorsPreflight: false`).
- Backend identity from API Gateway's verified claims only. The old
  `X-User-Id` / `X-User-Role` headers are ignored (NFR-8).
- A server-controlled mapping from the Cognito `sub` to existing application
  user ids (`n1`, `c1`, ...), so seeded authorship and task ownership carry over.
- Role and ownership enforcement in every handler, human approval enforced in
  the backend action path (NFR-24), and the Cognito identity recorded in audit
  events (FR-41).
- A nurse-scoped workspace read (`GET /incidents/{id}/workspace`) that returns
  only the caller's patients, assigned tasks, and own updates.
- Retry-safe update saves: a `clientRequestId` makes a repeated submission
  return the stored update instead of creating a duplicate.
- 111 backend tests, an offline template authorization audit, `cfn-lint`, and
  `sam validate --lint`.

Deployed once to a workshop account, where hosted login and `GET /me` worked
for nurse and charge nurse accounts. The rest of the deployed smoke test below
(CORS on gateway errors, token revocation, wrong-client tokens) has not been
run, and the workspace route was added after that deploy, so redeploy before
using it. Bedrock remains a labeled stub.

## How authentication works

```
Browser ──(hosted login, code + PKCE)──> Cognito ──> access token (scope carebridge/access)
Browser ──Authorization: Bearer <access token>──> API Gateway Cognito authorizer
           verifies signature, expiry, user pool, and required scope
        ──verified claims in requestContext.authorizer.claims──> Lambda (src/lib/auth.js)
```

`src/lib/auth.js` is the only identity source. It never reads the
`Authorization` header or decodes a JWT itself. On top of API Gateway's checks,
it requires:

| Check | Why |
| --- | --- |
| `token_use` is `access` | An ID token must never act as an API token. |
| `client_id` is the CareBridge SPA client | The Cognito authorizer accepts tokens from any app client in the pool. |
| `iss` is this user pool | Defense in depth. |
| `scope` includes `carebridge/access` | Defense in depth for the API Gateway scope requirement. |
| `sub` is UUID-shaped | It becomes part of a table key. |

Missing configuration (`COGNITO_APP_CLIENT_ID`, `COGNITO_ISSUER`) fails closed
with a 500. There is no header fallback, local-only bypass, or environment flag
that disables these checks.

### Role policy

Roles come from `cognito:groups`. API Gateway flattens claims to strings, so
`parseGroups()` accepts `"a"`, `"a,b"`, `"[a b]"`, JSON array strings, and real
arrays. The user must be in **exactly one** CareBridge group:

| Membership | Result |
| --- | --- |
| `nurse` or `charge_nurse` only | That role |
| No group | 403 `role_missing` |
| Both groups | 403 `role_conflict` (higher privilege is never picked) |
| Any other group, even alongside a valid one | 403 `role_unrecognized` |
| Group differs from the role recorded on the profile | 403 `role_mismatch` |

The pool is dedicated to CareBridge, so an unexpected group is treated as a
configuration error for an administrator to fix.

### Identity mapping

Cognito subs never replace application ids. An administrator binds each Cognito
account to an existing application user with `scripts/provision-identity.js`,
which writes two items in one transaction:

| PK | SK | Purpose |
| --- | --- | --- |
| `IDENTITY#<cognitoSub>` | `MAPPING` | `userId` the sub maps to |
| `USER#<userId>` | `PROFILE` | `displayName`, `role`, and the bound `cognitoSub` |

At request time both items must agree in both directions and the profile role
must equal the group role; otherwise the request is 403 `not_provisioned` or
`role_mismatch`. One sub maps to one user and one user binds to one sub. The
browser never supplies the mapping, and accounts are never matched by name.
Deleting the mapping blocks API access immediately, even for an unexpired token.

The authenticated actor is `{ userId, role, displayName, cognitoSub }`. Updates,
tasks, and decisions use `userId`; audit events also record `actorCognitoSub`.

### Endpoint permissions

Every route requires a provisioned account. `—` means 403.

| Method | Path | Nurse | Charge nurse | Requirements |
| --- | --- | --- | --- | --- |
| GET | `/me` | Own identity | Own identity | FR-1, FR-3 |
| GET | `/incidents/{id}` | Status and duration | Status and duration | FR-7 |
| GET | `/incidents/{id}/workspace` | Own patients, tasks, updates | — | FR-13, FR-38, FR-39, NFR-8 |
| GET | `/incidents/{id}/dashboard` | — | Full snapshot | FR-30, NFR-8 |
| POST | `/incidents` | — | Activate | FR-5 |
| POST | `/incidents/{id}/deactivate` | — | Close | FR-8 |
| POST | `/incidents/{id}/updates` | Author is self; patient must exist | Author is self; patient must exist | FR-13–FR-16 |
| PATCH | `/incidents/{id}/updates/{id}` | Own updates only (text, category, urgent) | Own updates only | FR-17 |
| POST | `/incidents/{id}/updates/{id}/process` | — | Run AI stub | FR-18–FR-23 |
| POST | `/incidents/{id}/recommendations/{id}/approve` | — | Approve or modify, creates task | FR-33, NFR-24 |
| POST | `/incidents/{id}/recommendations/{id}/reject` | — | Reject, applies nothing | NFR-25 |
| POST | `/incidents/{id}/tasks` | — | Create | FR-36 |
| PATCH | `/incidents/{id}/tasks/{id}` | Status on own assigned task | Status, assignee, priority, due time | FR-34, FR-38 |

The dashboard contains every patient, task, and AI recommendation for the
incident, so nurses do not receive it just because they signed in. Nurses read
the workspace instead: patients assigned to them (plus any patient one of their
tasks references, flagged `assignedToMe: false`), tasks assigned to them with
`overdue` / `unconfirmed` flags, and updates they wrote. It never includes other
nurses' updates or tasks, AI recommendations, audit events, or table keys, and
it has no parameter for reading another nurse's data. Both views compute
indicators with `src/lib/indicators.js`.

`POST .../updates` accepts an optional `clientRequestId` (8–64 letters, digits,
or hyphens). The update id is derived from the author and that value, so a
retried submission returns the stored update with `200` instead of creating a
second one; the same value from another nurse is a separate update. Corrections
push the prior text, category, and urgent flag into `editHistory` with the time
and author of the change. Nurse
ownership checks are repeated inside the DynamoDB write condition, so a
concurrent reassignment cannot slip through.

### Tokens and sign-out

- Access and ID tokens last 30 minutes, refresh tokens 12 hours. Token
  revocation is enabled on the app client.
- API Gateway's Cognito authorizer checks signature and expiry only, not
  revocation. After sign-out, an access token that was already issued still
  works at the API until it expires (up to 30 minutes). To cut off a user
  immediately, remove their mapping (below) and disable them in Cognito.
- Frontend token storage and the sign-out sequence are described in the
  [root README](../README.md#sign-in-and-session-behavior).

## Single-table design

One table, `CareBridge-<stage>`. Incident records live under `INCIDENT#<id>`;
the sort-key prefix is the entity type, keeping patients, updates, tasks, AI
recommendations, and audit history logically separate (NFR-27).

| PK | SK | Entity |
| --- | --- | --- |
| `INCIDENT#<id>` | `META` | Incident metadata (FR-5–FR-8) |
| `INCIDENT#<id>` | `PATIENT#<patientId>` | Patient continuity profile (FR-9–FR-12) |
| `INCIDENT#<id>` | `UPDATE#<updateId>` | Nurse update, original source (FR-13–FR-17) |
| `INCIDENT#<id>` | `TASK#<taskId>` | Task (FR-36–FR-40) |
| `INCIDENT#<id>` | `REC#<recId>` | AI recommendation: proposed / approved / rejected |
| `INCIDENT#<id>` | `AUDIT#<isoTs>#<uuid>` | Append-only audit event (FR-41) |
| `USER#<userId>` | `PROFILE` | Application user, role, bound Cognito sub |
| `IDENTITY#<cognitoSub>` | `MAPPING` | Cognito sub to application user id |

`GSI1` (`INCIDENT#<id>#NURSE#<nurseId>` / `TASK#<taskId>`) supports nurse-scoped
task lookups.

Other design rules are unchanged: updates persist before AI processing (NFR-3,
FR-42), AI output is stored separately and never overwrites sources (NFR-15),
and approval runs one `TransactWriteItems` guarded by `status = proposed`, so
retries never duplicate a task.

## Project layout

```
backend/
  template.yaml                 # Cognito, REST API + default authorizer, table, functions
  env.local.json                # sam local env vars (placeholders only)
  package.json                  # tests and admin/dev scripts
  src/                          # Lambda code (CodeUri), runtime deps in src/package.json
    lib/auth.js                 # verified-claims identity, role policy, mapping lookup
    lib/http.js                 # responses, CORS headers, errors
    lib/indicators.js           # overdue, unverified, and incident-duration rules
    lib/keys.js lib/ddb.js lib/audit.js lib/ids.js lib/bedrock.js
    handlers/me.js incidents.js dashboard.js workspace.js updates.js recommendations.js tasks.js
  scripts/
    provision-identity.js       # bind or remove a Cognito account mapping (admin)
    seed.js                     # load ../../src/data.js fixtures (DynamoDB Local, or --aws)
    create-local-table.js
    check-template-auth.py      # offline audit of per-method authorization
    lib/seed-items.js lib/provisioning.js
  test/                         # node:test suites with mocked authorizer claims
```

## Checks

```bash
cd backend
npm install && npm install --prefix src
npm test                                   # 111 tests, in-memory DynamoDB double

# Template checks (SAM CLI / cfn-lint, or run them through uv as shown)
uvx cfn-lint template.yaml
SAM_CLI_TELEMETRY=0 uvx --from aws-sam-cli sam validate --lint --region us-east-1
uv run --no-project --with aws-sam-translator --with pyyaml \
  python scripts/check-template-auth.py   # fails if any route lacks the scope
```

The tests use **mocked** authorizer claims. They prove how Lambda treats the
claims API Gateway passes it: missing identity, header impersonation, ID tokens,
wrong client or pool, missing scope, unmapped users, role conflicts, wrong-role
requests, ownership of updates and tasks, recommendation approval, and that
seeded ownership survives the mapping. They do not prove the deployed Cognito
authorizer verifies tokens.

## Run locally

Requires Docker, the AWS SAM CLI, and Node 22+.

```bash
cd backend
npm run ddb:up              # DynamoDB Local on :8000 (Docker)
npm run ddb:create-table    # create CareBridge-dev
npm run seed                # fixtures plus user profiles n1-n6 and c1
npm run local:api           # sam build + sam local start-api
```

`sam local start-api` does not run Cognito authorizers, so protected requests
reach Lambda without verified claims and return 401. That is expected. It does
not show that the deployed authorizer works, and there is intentionally no way
to bypass it. Use `npm test` for local authorization behavior and the deployed
smoke test for the real authorizer.

To exercise the mapping against DynamoDB Local, `--sub` replaces the Cognito
lookup only when `DYNAMODB_ENDPOINT` is set:

```bash
DYNAMODB_ENDPOINT=http://127.0.0.1:8000 TABLE_NAME=CareBridge-dev \
  node scripts/provision-identity.js --sub 11111111-1111-4111-8111-111111111111 --app-user-id n1 --role nurse
```

## Deploy

Deploying creates billable AWS resources (Cognito, API Gateway, Lambda,
DynamoDB). Nothing in this repository deploys automatically.

### Required permissions

The deploying principal needs, for this stack's resources:

- CloudFormation: create, update, describe, and delete stacks and change sets.
- S3: the SAM-managed artifact bucket (`sam deploy --resolve-s3` creates it once).
- IAM: create, tag, and delete Lambda execution roles; attach and put role
  policies; `iam:PassRole` for those roles. Deploy with `CAPABILITY_IAM`.
- Lambda: create, update, and delete functions; add and remove permissions.
- API Gateway: `apigateway:*` on the REST API and its stage.
- Cognito: create, update, describe, and delete user pools, app clients,
  domains, groups, and resource servers.
- DynamoDB: create, describe, update, tag, and delete the table, and update
  continuous backups.

Administrators who create accounts and mappings need, scoped to the pool and
table ARNs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["cognito-idp:AdminCreateUser", "cognito-idp:AdminAddUserToGroup",
                 "cognito-idp:AdminRemoveUserFromGroup", "cognito-idp:AdminGetUser",
                 "cognito-idp:AdminListGroupsForUser", "cognito-idp:AdminDisableUser",
                 "cognito-idp:ListUsers"],
      "Resource": "arn:aws:cognito-idp:<region>:<account>:userpool/<UserPoolId>" },
    { "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
                 "dynamodb:DeleteItem", "dynamodb:ConditionCheckItem"],
      "Resource": "arn:aws:dynamodb:<region>:<account>:table/CareBridge-<stage>" }
  ]
}
```

### Commands

Pick a globally unique domain prefix without `aws`, `amazon`, or `cognito`.

```bash
cd backend
npm install && npm install --prefix src
sam build
sam deploy --guided --capabilities CAPABILITY_IAM --resolve-s3 \
  --stack-name carebridge-dev \
  --parameter-overrides \
    Stage=dev \
    CognitoDomainPrefix=<your-team-prefix> \
    FrontendOrigin=http://localhost:5173 \
    CallbackUrl=http://localhost:5173/auth/callback \
    SignOutUrl=http://localhost:5173/
```

`--guided` saves answers to `samconfig.toml`, which is gitignored. Read the
outputs with:

```bash
aws cloudformation describe-stacks --stack-name carebridge-dev \
  --query "Stacks[0].Outputs" --output table
```

| Output | Use |
| --- | --- |
| `ApiBaseUrl` | `VITE_API_BASE_URL` |
| `Region` | `VITE_COGNITO_REGION` |
| `UserPoolId` | `VITE_COGNITO_USER_POOL_ID`, admin commands |
| `UserPoolClientId` | `VITE_COGNITO_APP_CLIENT_ID` (public, no secret) |
| `CognitoLoginDomain` | `VITE_COGNITO_DOMAIN` |
| `CallbackUrl`, `SignOutUrl` | `VITE_AUTH_REDIRECT_URI`, `VITE_AUTH_LOGOUT_URI` |
| `CognitoIssuer`, `TableName` | Reference |

Populating the frontend from these outputs is covered in the
[root README](../README.md#populate-frontend-config-from-stack-outputs).

The user pool has no deletion protection, so deleting the stack deletes all
accounts.

### Create accounts and assign groups

Create at least two nurses and one charge nurse. Use email addresses the team
controls (plus-addressing works). Names should be the synthetic personas.

In the console:

1. Open **Amazon Cognito → User pools → `carebridge-<stage>`**.
2. **User management → Users → Create user.** Choose **Send an email
   invitation** (or **Don't send an invitation** and share the temporary
   password privately), enter the email, select **Mark email address as
   verified**, and set or generate a temporary password. Create the user.
3. Repeat for each account, for example `nurse.one@…`, `nurse.two@…`, `charge@…`.
4. **User management → Groups → `nurse` → Add user to group** for each nurse.
   Add the charge account to **`charge_nurse`**. Put each user in exactly one
   CareBridge group.
5. Each user signs in once through the app and sets a permanent password on
   the hosted login page.

The same with the AWS CLI:

```bash
aws cognito-idp admin-create-user --user-pool-id <UserPoolId> \
  --username nurse.one@example.org \
  --user-attributes Name=email,Value=nurse.one@example.org Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --user-pool-id <UserPoolId> \
  --username nurse.one@example.org --group-name nurse
```

### Provision identity mappings

Bind each account to an application user. The seeded fixtures use `n1`–`n6`
for nurses and `c1` for the charge nurse; reuse those ids so existing updates
and tasks keep their owners. The script reads the sub and groups from Cognito
and refuses to bind unless the user is in exactly the requested group.

```bash
cd backend
export AWS_REGION=<region> TABLE_NAME=CareBridge-dev POOL=<UserPoolId>

node scripts/provision-identity.js --user-pool-id "$POOL" --username nurse.one@example.org \
  --app-user-id n1 --role nurse --display-name "Sarah Chen"
node scripts/provision-identity.js --user-pool-id "$POOL" --username nurse.two@example.org \
  --app-user-id n2 --role nurse --display-name "James Wilson"
node scripts/provision-identity.js --user-pool-id "$POOL" --username charge@example.org \
  --app-user-id c1 --role charge_nurse --display-name "Olivia Bennett"
```

Re-running a binding is safe. Re-pointing a sub, binding a second account to the
same user, or changing a recorded role is refused. To change a role, move the
Cognito group first, then rerun with `--allow-role-change`. To revoke access:

```bash
node scripts/provision-identity.js --remove --user-pool-id "$POOL" --username nurse.two@example.org
aws cognito-idp admin-disable-user --user-pool-id "$POOL" --username nurse.two@example.org
```

The deployed table starts empty. The provisioning script creates any missing
profile. To load the demo incident `INC-0042` into the deployed table, run the
seed with the explicit `--aws` flag and your admin credentials:

```bash
unset DYNAMODB_ENDPOINT
AWS_REGION=<region> TABLE_NAME=CareBridge-dev node scripts/seed.js --aws
```

Run it once on a fresh table. Rerunning it rewrites the demo incident's items,
which resets patients, seeded tasks, and seeded updates and discards later
corrections to them; updates and tasks created in the app keep their own items.
Existing user profiles and identity bindings are never changed.

### Change callback and sign-out URLs for hosting

The stack registers one frontend origin, callback URL, and sign-out URL, and
uses the same origin for CORS. For a hosted frontend, deploy with HTTPS values
(the template rejects plain http except `localhost`):

```bash
sam deploy --stack-name carebridge-demo --capabilities CAPABILITY_IAM --resolve-s3 \
  --parameter-overrides Stage=demo CognitoDomainPrefix=<another-prefix> \
    FrontendOrigin=https://carebridge.example.org \
    CallbackUrl=https://carebridge.example.org/auth/callback \
    SignOutUrl=https://carebridge.example.org/
```

Updating an existing stack's URLs works the same way, but it replaces the
localhost values. To keep local development working, use a separate stage
(`dev` for localhost, `demo` for hosting); each stage has its own pool, users,
and table. Then rebuild the frontend with the matching `VITE_` values.

## Deployed smoke test

Run after deploying, creating and mapping two nurses and one charge nurse, and
starting the frontend at `http://localhost:5173` with `.env.local` populated.
Use only synthetic data. Treat copied tokens as secrets: read them with
`read -rs` so they stay out of shell history, and don't paste them into chat or
tickets.

```bash
API=<ApiBaseUrl>; ORIGIN=http://localhost:5173
```

**CORS preflight (no token).** Expect `200` with
`Access-Control-Allow-Origin: http://localhost:5173` and `Authorization` in the
allowed headers.

```bash
curl -si -X OPTIONS "$API/me" -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: authorization" \
  | grep -iE "^HTTP|access-control"
```

**No token, header impersonation, invalid token.** Each should be `401` from API
Gateway with the `Access-Control-Allow-Origin` header present.

```bash
curl -si "$API/me" -H "Origin: $ORIGIN" | grep -iE "^HTTP|access-control-allow-origin"
curl -si "$API/me" -H "X-User-Id: c1" -H "X-User-Role: charge_nurse" | head -1
curl -si "$API/me" -H "Authorization: Bearer not.a.jwt" | head -1
```

**Browser login, callback, and /me.** Open `http://localhost:5173`, choose
**Sign in**, and sign in as the charge nurse on the hosted page (set a permanent
password the first time). Expect a return to `/auth/callback`, the address bar
changing to `/`, and the dashboard showing "Olivia Bennett · Charge nurse ·
Signed in". In DevTools:

- Network: the `OPTIONS /me` preflight succeeds; `GET /me` sends
  `Authorization: Bearer …` and no `X-User-*` headers; no CORS errors in the
  console.
- Application → Session Storage: one `oidc.user:…` entry; nothing under Local
  Storage.

Copy the access token from the `GET /me` request's `Authorization` header (the
part after `Bearer `). Repeat in a private window for a nurse.

```bash
read -rs CHARGE_TOKEN; read -rs NURSE_TOKEN
```

**Nurse token.** `/me` returns `200` with the mapped id (`n1`) and role `nurse`.
Charge-only routes return `403 forbidden`.

```bash
curl -s "$API/me" -H "Authorization: Bearer $NURSE_TOKEN"
curl -si -X POST "$API/incidents" -H "Authorization: Bearer $NURSE_TOKEN" \
  -H "Content-Type: application/json" -d '{"type":"EHR outage"}' | head -1
```

**Charge nurse token.** `/me` returns role `charge_nurse`. Create, read, and
close a synthetic incident:

```bash
curl -s "$API/me" -H "Authorization: Bearer $CHARGE_TOKEN"
INC=$(curl -s -X POST "$API/incidents" -H "Authorization: Bearer $CHARGE_TOKEN" \
  -H "Content-Type: application/json" -d '{"type":"EHR outage","unit":"Smoke test"}' \
  | sed -E 's/.*"incidentId":"([^"]+)".*/\1/')
curl -si "$API/incidents/$INC/dashboard" -H "Authorization: Bearer $CHARGE_TOKEN" | head -1   # 200
curl -si "$API/incidents/$INC/dashboard" -H "Authorization: Bearer $NURSE_TOKEN" | head -1    # 403
curl -si -X POST "$API/incidents/$INC/deactivate" -H "Authorization: Bearer $CHARGE_TOKEN" | head -1  # 200
```

**Nurse workspace.** With the demo incident seeded (`--aws`) and the nurse bound
to `n1`, the workspace contains only `n1` records and the charge nurse is refused:

```bash
curl -s "$API/incidents/INC-0042/workspace" -H "Authorization: Bearer $NURSE_TOKEN"            # n1 patients/tasks/updates only
curl -si "$API/incidents/INC-0042/workspace" -H "Authorization: Bearer $CHARGE_TOKEN" | head -1  # 403
```

**ID token instead of access token.** In Session Storage, copy `id_token` from
the `oidc.user:…` entry. Expect `401` because the API requires the access-token
scope.

```bash
read -rs ID_TOKEN; curl -si "$API/me" -H "Authorization: Bearer $ID_TOKEN" | head -1
```

**Tampered and expired tokens.** Change one character near the end of
`$NURSE_TOKEN` and call `/me`: expect `401`. Call `/me` with a token captured
more than 30 minutes earlier: expect `401`.

**Wrong app client token.** API Gateway accepts any app client in the pool, so
this checks the Lambda `client_id` validation.

1. In the console, add a temporary app client: public, no secret, authorization
   code grant, scopes `openid` and `carebridge/access`, callback
   `http://localhost:9999/callback`.
2. Open
   `<CognitoLoginDomain>/oauth2/authorize?response_type=code&client_id=<TEMP_CLIENT_ID>&redirect_uri=http%3A%2F%2Flocalhost%3A9999%2Fcallback&scope=openid+carebridge%2Faccess`
   and sign in. The browser can't load `localhost:9999`; copy `code` from the
   address bar.
3. Exchange the code and call the API. Expect `401 invalid_token` from Lambda.

   ```bash
   curl -s -X POST "<CognitoLoginDomain>/oauth2/token" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=authorization_code&client_id=<TEMP_CLIENT_ID>&code=<CODE>&redirect_uri=http%3A%2F%2Flocalhost%3A9999%2Fcallback"
   read -rs OTHER_TOKEN; curl -s "$API/me" -H "Authorization: Bearer $OTHER_TOKEN"
   ```

4. Delete the temporary app client.

**Unmapped account (optional).** Create a fourth user in `nurse` without running
the provisioning script. The app shows "Your account isn't set up yet" and `/me`
returns `403 not_provisioned`.

**Sign-out.** Choose **Sign out**. Expect a redirect through
`<CognitoLoginDomain>/logout` back to `http://localhost:5173/`, the sign-in
screen, and no `oidc.` keys in Session Storage. Choosing **Sign in** again asks
for a password. The old `$CHARGE_TOKEN` still works at the API until it expires
(the documented revocation limit). Run
`provision-identity.js --remove` for that user and `/me` with the same token
returns `403 not_provisioned`.

## Remaining gaps

- No live AWS validation yet; run the smoke test above after the first deploy.
- The charge nurse dashboard UI still renders fixtures, so updates and task
  changes saved from the nurse view appear only through `GET .../dashboard`,
  not on screen.
- Nurses read one configured incident (`VITE_INCIDENT_ID`); there is no
  endpoint for discovering the active incident.
- Task status changes are not de-duplicated by request id, but setting the same
  status twice is harmless; each change writes an audit event.
- The system administrator persona has no in-app role; administration happens
  in the Cognito console and `provision-identity.js`.
- Revoked or signed-out access tokens remain valid at API Gateway for up to 30
  minutes. A Lambda authorizer that checks revocation would close this.
- Lambda relies on API Gateway for signature and expiry checks and
  intentionally does not read the `Authorization` header itself.
- MFA, Cognito threat protection, and other advanced authentication are stretch
  work (FR-1 is met with password sign-in).
- Live Bedrock, Guardrails, the Knowledge Base policy assistant (FR-26–FR-29),
  patient-profile writes, escalation (FR-35), and handoff export (FR-43) remain
  unimplemented.
