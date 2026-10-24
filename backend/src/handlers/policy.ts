/**
 * Policy assistant endpoint (task 6.3).
 *
 *   POST /policy/ask  { question }  -> PolicyAnswer
 *
 * Any authenticated demo role may ask. Answers are grounded in the Bedrock
 * Knowledge Base; when no supporting policy is found the handler returns the
 * fixed no-policy response (never invents policy).
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  getActor,
  ok,
  parseBody,
  requireString,
  withErrorHandling,
  type HttpResult,
} from '../lib/http.ts';
import { askPolicy } from '../lib/policy.ts';
import type { PolicyAskRequest } from '../lib/types.ts';

export const handler = withErrorHandling(
  async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
    getActor(event); // require a selected demo role
    const body = parseBody<PolicyAskRequest>(event);
    const question = requireString(body.question, 'question');

    const answer = await askPolicy(question);
    return ok(answer);
  },
);
