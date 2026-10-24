/**
 * Placeholder health-check handler (task 1.3).
 *
 * Confirms the HTTP API -> Lambda wiring works end to end before real route
 * handlers are added in Phase 2. Returns a small JSON status payload.
 */

interface HttpApiResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export const handler = async (): Promise<HttpApiResult> => {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      service: 'carebridge',
      status: 'ok',
      time: new Date().toISOString(),
    }),
  };
};
