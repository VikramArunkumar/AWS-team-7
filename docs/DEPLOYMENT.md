# CareBridge — AWS Deployment Guide

This guide deploys the CareBridge MVP: a React/Vite SPA, an API Gateway + Lambda
backend, DynamoDB, S3 for policy documents, Amazon Bedrock (Converse API), and a
Bedrock Knowledge Base for cited policy answers.

> All patient data is synthetic. CareBridge never diagnoses, prescribes, changes
> medication orders, or acts autonomously. AI output is advisory and requires
> human approval.

---

## 0. Pre-deployment safety checklist

Run these before every deploy. The repository has been verified against each
item at the time of writing.

| Check | How to verify | Current status |
|---|---|---|
| No real patient data | `grep -ri "patient" data/ frontend/src` — names are `DEMO Patient P-1001` etc. | Pass — synthetic only |
| No secrets committed | `git ls-files \| grep -Ei "\.env$\|credentials\|secret\|\.pem\|\.key"` returns nothing; only `.env.example` is tracked | Pass |
| Bedrock called from backend only | `grep -r "aws-sdk" frontend/package.json` returns nothing; frontend references Bedrock only in type names/labels | Pass |
| Original updates preserved | `backend/src/handlers/updates.ts` uses `putItemIfAbsent` (write-once); process handler never writes the `UPDATE#` item | Pass |
| Human approval required | `backend/src/handlers/recommendations.ts` calls `requireRole(actor, 'charge-nurse')`; a task is only created on approve/modify-approve | Pass |
| AI failures do not lose data | `backend/src/handlers/process.ts` catches Bedrock errors, preserves the raw update, stores an `AiProcessingError`, creates no task | Pass |

Quick commands:

```bash
# Secrets / env files that must never be committed
git ls-files | grep -Ei '\.env$|credentials|secret|\.pem$|\.key$'   # expect: empty

# Frontend must not bundle any AWS SDK
grep -r "@aws-sdk" frontend/package.json frontend/src                # expect: empty

# Verify the invariants are present in code
grep -n "putItemIfAbsent" backend/src/handlers/updates.ts
grep -n "requireRole(actor, 'charge-nurse')" backend/src/handlers/recommendations.ts

# Full automated suite (mocked Bedrock, no AWS calls) must pass
npm test
```

The automated acceptance suite (`backend/src/acceptance.test.ts`) encodes the
last three invariants as tests; a green `npm test` is part of this checklist.

---

## 1. Prerequisites

- **Node.js >= 20** (tested on Node 24) and **npm >= 10**
- **AWS CLI v2** — configured with `aws configure` (or SSO)
- **AWS SAM CLI** — for build/deploy
- **Docker** — required by `sam build` (esbuild container) and `sam local`
- An AWS account with permission to create IAM roles, Lambda, API Gateway,
  DynamoDB, S3, and to use Amazon Bedrock
- A region where your chosen Bedrock model **and** Knowledge Bases are available
  (e.g. `us-east-1` or `us-west-2`)

```bash
node --version
aws --version
sam --version
docker --version
```

---

## 2. Required environment variables

Copy `.env.example` to `.env` and fill in values. `.env` is gitignored — never
commit it.

| Variable | Scope | Purpose |
|---|---|---|
| `TABLE_NAME` | backend | DynamoDB table name (default `CareBridge`) |
| `BUCKET_NAME` | backend / seed | S3 bucket for policy docs + continuity packets |
| `AWS_REGION` | all | Deployment region (Lambda provides this at runtime) |
| `BEDROCK_MODEL_ID` | backend | Converse model id for extraction/prioritization |
| `BEDROCK_FALLBACK_MODEL_ID` | backend | Optional fallback model (stretch) |
| `KB_ID` | backend | Bedrock Knowledge Base id for policy Q&A |
| `KB_MODEL_ARN` | backend | Model ARN used by RetrieveAndGenerate |
| `CORS_ORIGIN` | backend | Allowed SPA origin (e.g. CloudFront URL) |
| `LOG_LEVEL` | backend | `debug` \| `info` \| `warn` \| `error` |
| `VITE_API_BASE_URL` | frontend | API Gateway base URL for the SPA |

Dev-only toggles (never set in production): `BEDROCK_MOCK=1` returns canned
Converse JSON; `POLICY_MOCK=1` returns canned policy answers. Both exist so the
app runs without live Bedrock during development.

The backend reads `BEDROCK_MODEL_ID`, `KB_ID`, and `KB_MODEL_ARN` **at call
time**, and these are passed to Lambda as SAM parameters (section 9), so you set
them once at deploy.

---

## 3. IAM permissions

### 3.1 Your deployer identity

The principal running `sam deploy` needs to create the stack's resources:
CloudFormation, IAM role creation (`CAPABILITY_IAM`), Lambda, API Gateway,
DynamoDB, S3, and Logs. A broad managed policy works for a hackathon; scope it
down for anything longer-lived.

### 3.2 Lambda execution roles (provisioned by SAM, least privilege)

SAM creates a role per function. The template grants only what each needs:

- **All functions** — `DynamoDBCrudPolicy` scoped to the `CareBridge` table ARN
  (and its `GSI1` index), plus CloudWatch Logs. No `Scan`, no `DeleteItem`.
- **ProcessFunction** — `bedrock:Converse` and `bedrock:InvokeModel` on the
  specific model ARN(s) (`BEDROCK_MODEL_ID`, and `FallbackModelId` if set).
- **PolicyFunction** — `bedrock:RetrieveAndGenerate` and `bedrock:Retrieve` on
  the Knowledge Base ARN, and `bedrock:InvokeModel` on `KB_MODEL_ARN`. These
  statements are omitted automatically when `KbId`/`KbModelArn` are empty
  (CloudFormation conditions), so an un-provisioned KB does not break the deploy.
- **S3** — the Knowledge Base service role reads the policy bucket for ingestion;
  the bucket blocks all public access and is encrypted (AES256).

No wildcard resource ARNs are used on Bedrock or S3. There is no browser-facing
IAM — the SPA calls only API Gateway.

---

## 4. DynamoDB setup

The table is created by the SAM stack (`infra/template.yaml`); you do not create
it by hand.

- **Table**: `CareBridge`, on-demand billing (`PAY_PER_REQUEST`).
- **Keys**: `PK` (partition), `SK` (sort).
- **GSI**: `GSI1` on `GSI1PK` / `GSI1SK`, projection `ALL`.
- **Single-table layout** (see `.kiro/specs/carebridge-mvp/design.md`): outage
  state, patients, updates, extractions/analyses, recommendations, tasks, and
  audit entries, distinguished by key prefixes. Updates are write-once.

No manual indexes or capacity settings are required. To inspect after deploy:

```bash
aws dynamodb describe-table --table-name CareBridge --region <region>
```

---

## 5. S3 policy-document setup

The SAM stack creates the bucket (Block Public Access on, SSE-AES256). Upload the
synthetic policy documents from `data/policies/` under a `policies/` prefix — the
seed script does this with `--with-policies` (section 10), or manually:

```bash
BUCKET=$(aws cloudformation describe-stacks --stack-name carebridge-mvp \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)

aws s3 cp data/policies/ "s3://$BUCKET/policies/" --recursive
```

The five synthetic policy files cover EHR outage, medication-system outage,
communication/escalation, manual documentation, and staffing disruption. These
become the Knowledge Base data source.

---

## 6. Bedrock model-access instructions

Bedrock foundation models are opt-in per account and region.

1. Open the **Amazon Bedrock** console in your target region.
2. Go to **Model access** and request access to the model you set in
   `BEDROCK_MODEL_ID` (e.g. a Claude model) and any fallback.
3. Wait until the model shows **Access granted**.
4. Confirm access from the CLI:

   ```bash
   aws bedrock list-foundation-models --region <region> \
     --query "modelSummaries[?contains(modelId, 'claude')].modelId"
   ```

5. The model id you enable must match `BEDROCK_MODEL_ID` exactly. For
   `KB_MODEL_ARN`, use the full ARN form, e.g.
   `arn:aws:bedrock:<region>::foundation-model/<model-id>`.

If a model isn't available in your region, pick a region that offers both the
model and Knowledge Bases, and deploy there.

---

## 7. Knowledge Base configuration instructions

Creating a Bedrock Knowledge Base cleanly requires a vector store, which is
awkward to stand up purely in SAM for an 18-hour MVP. Provision it once
(console or CLI) and pass its id/model ARN to the stack as parameters. Until the
KB exists, the policy endpoint safely returns "no matching policy found" rather
than guessing.

Steps (console):

1. Ensure the policy docs are in S3 under `s3://<bucket>/policies/` (section 5).
2. Bedrock console -> **Knowledge bases** -> **Create knowledge base**.
3. Data source: the S3 bucket/prefix above.
4. Embeddings model: choose an available embeddings model; for the vector store,
   accept the quick-create **Amazon OpenSearch Serverless** option.
5. Create, then **Sync** the data source so the documents are ingested.
6. Note the **Knowledge base ID** and the generation **model ARN**.
7. Pass them to the stack: `KbId=<kb-id>` and
   `KbModelArn=arn:aws:bedrock:<region>::foundation-model/<model-id>`
   (section 9), then redeploy.

Re-run the data-source **Sync** whenever policy documents change.

---

## 8. Frontend build instructions

The SPA is static and calls only API Gateway (never Bedrock directly).

```bash
# From the repo root
npm install

# Point the SPA at your deployed API (from stack outputs)
export VITE_API_BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com"

# Build (type-checks then bundles to frontend/dist)
npm run build --workspace @carebridge/frontend
```

Host the contents of `frontend/dist/` on any static host. A simple path:

```bash
# Create a private bucket + CloudFront, or reuse an existing static site bucket
aws s3 sync frontend/dist/ "s3://<your-spa-bucket>/" --delete
# (optional) invalidate CloudFront
aws cloudfront create-invalidation --distribution-id <id> --paths '/*'
```

Set the backend `CorsOrigin` parameter to the SPA's final origin and redeploy so
CORS allows it. For a quick demo you can instead run the SPA locally
(`npm run dev --workspace @carebridge/frontend`) pointed at the deployed API.

---

## 9. Backend deployment instructions

```bash
# Build the Lambdas (esbuild via SAM; requires Docker)
sam build -t infra/template.yaml

# First deploy — guided, captures parameters into samconfig.toml
sam deploy --guided -t infra/template.yaml
```

When prompted, set the parameters:

- `BedrockModelId` — the model you enabled in section 6
- `FallbackModelId` — optional
- `KbId` / `KbModelArn` — from section 7 (leave blank until the KB exists)
- `CorsOrigin` — your SPA origin

Subsequent deploys:

```bash
sam deploy -t infra/template.yaml          # uses saved samconfig.toml
sam sync --watch -t infra/template.yaml    # fast iteration during the hack
```

Grab the outputs (API URL, table, bucket):

```bash
aws cloudformation describe-stacks --stack-name carebridge-mvp \
  --query "Stacks[0].Outputs" --output table
```

Smoke-test the API:

```bash
curl "https://<api-id>.execute-api.<region>.amazonaws.com/health"
# -> {"service":"carebridge","status":"ok",...}
```

---

## 10. Seed-data instructions

Populate (or reset) the synthetic demo data in DynamoDB and upload policy docs.
Requires AWS credentials and the deployed `TABLE_NAME` / `BUCKET_NAME`.

```bash
export TABLE_NAME=CareBridge
export BUCKET_NAME=<bucket-from-stack-outputs>

# Seed the demo dataset (4 patients, 2 nurses + 1 charge nurse, active outage,
# 6 updates incl. 1 urgent, tasks incl. 1 overdue, 1 staffing gap)
npm run seed --workspace @carebridge/scripts

# Reset to the original demo state (e.g. right before recording the video)
npm run seed:reset --workspace @carebridge/scripts

# Reset AND upload the synthetic policy docs to S3
npm run seed:all --workspace @carebridge/scripts
```

After uploading or changing policy docs, re-run the Knowledge Base **Sync**
(section 7). In the browser demo, the dashboard also has a **Reset demo** button
that restores the in-app state without touching AWS.

---

## 11. Troubleshooting

**`sam build` fails / esbuild errors** — ensure Docker is running. Re-run
`sam build` after `npm install`. Confirm Node 20+ locally.

**`AccessDeniedException` calling Bedrock** — the model isn't enabled in this
region, or `BEDROCK_MODEL_ID` doesn't match an enabled model. Re-check section 6
and that the ProcessFunction role targets the correct model ARN.

**Policy assistant always says "no matching policy found"** — expected until the
Knowledge Base is provisioned and `KbId`/`KbModelArn` are set and the stack
redeployed. Also confirm the data source has been **Synced** after upload. This
is the safe, intended fallback — the assistant never invents policy.

**CORS errors in the browser** — the `CorsOrigin` parameter must exactly match
the SPA origin (scheme + host + port). Update the parameter and redeploy.

**502 from `/updates/{id}/process`** — a Bedrock failure or malformed model
output. By design the original update is preserved and no task is created; the
response includes a fallback message. Retry, or check the model access/region.
Verify data wasn't lost: `aws dynamodb get-item` the `UPDATE#` item.

**403 approving a recommendation** — approval requires the charge-nurse role.
The SPA sends `X-Demo-Role: charge-nurse` / `X-Demo-User`; a nurse role is
correctly rejected.

**`ConditionalCheckFailedException` on update submit** — the write-once guard
fired (duplicate update id). Submitting again generates a new id; this guard is
what protects the immutability invariant.

**DynamoDB `ResourceNotFoundException`** — the stack isn't deployed or
`TABLE_NAME` is wrong. Confirm with `describe-table` and the stack outputs.

**Knowledge Base `ValidationException` on sync** — check the S3 data source
prefix matches where the docs were uploaded (`policies/`) and that the KB service
role can read the bucket.

**Seed script can't connect** — set `TABLE_NAME` (and `BUCKET_NAME` for
`--with-policies`), ensure AWS credentials are present, and that the region
matches the deployed stack (`AWS_REGION` / profile).

---

## 12. Teardown

```bash
# Empty the bucket first (CloudFormation won't delete a non-empty bucket)
aws s3 rm "s3://<bucket>" --recursive
sam delete --stack-name carebridge-mvp
```

Delete the Knowledge Base and its OpenSearch Serverless collection separately in
the Bedrock console if you provisioned them outside the stack.
