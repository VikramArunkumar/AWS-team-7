/**
 * Audit history endpoint (Capability 10 — part of the core end-to-end path).
 *
 *   GET /audit  -> { entries: AuditEntry[] }  (reverse chronological)
 *
 * Any selected demo role may read the audit history.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { getActor, ok, withErrorHandling, type HttpResult } from '../lib/http.ts';
import { listAudit } from '../lib/audit.ts';

export const handler = withErrorHandling(
  async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
    getActor(event);
    const entries = await listAudit();
    return ok({ entries });
  },
);
