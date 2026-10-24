// Policy assistant (FR-26 to FR-29): POST /policy/ask
//
// Any provisioned nurse or charge nurse may ask. The answer comes only from the
// Bedrock Knowledge Base and is labeled AI-generated with citations to the
// retrieved documents; "no relevant policy" is an explicit result, not an
// error. The question text is never logged.

import { authenticate, requireRole, ROLES } from '../lib/auth.js';
import { answerPolicyQuestion } from '../lib/policy-kb.js';
import { BedrockError } from '../lib/bedrock.js';
import {
  ok, withErrorHandling, parseBody, HttpError,
} from '../lib/http.js';

const MAX_QUESTION = 500;

async function askPolicy(event) {
  const actor = await authenticate(event);
  requireRole(actor, ROLES.NURSE, ROLES.CHARGE_NURSE);

  const { question } = parseBody(event);
  if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION) {
    throw new HttpError(400, 'invalid_question', `Ask a question of 1 to ${MAX_QUESTION} characters.`);
  }

  let result;
  try {
    result = await answerPolicyQuestion(question.trim());
  } catch (err) {
    console.error('policy_failed', err?.name, err?.code, err instanceof BedrockError ? err.message : '');
    if (err instanceof BedrockError && err.code === 'not_configured') {
      throw new HttpError(503, 'policy_unavailable', 'The policy Knowledge Base is not configured.');
    }
    if (err instanceof BedrockError && err.code === 'guardrail_blocked') {
      throw new HttpError(422, 'ai_refused',
        'The assistant cannot answer that question. Consult facility policy or your charge nurse directly.');
    }
    throw new HttpError(502, 'ai_unavailable', 'The policy assistant is unavailable. Try again shortly.');
  }

  return ok({
    ...result,
    aiGenerated: true,          // FR-23
    verifyBeforeActing: true,   // FR-24
  });
}

export const handler = withErrorHandling(async (event) => {
  if (event.httpMethod === 'POST') return askPolicy(event);
  throw new HttpError(405, 'method_not_allowed', 'Unsupported method.');
});
