/**
 * Shared in-memory DynamoDB Document client fake for tests.
 *
 * Supports the commands the handlers use (Get, Put with optional
 * attribute_not_exists condition, Query by PK prefix, Query on GSI1). It is
 * intentionally small and deterministic. No AWS calls are ever made.
 */

export class FakeDynamo {
  store = new Map<string, Record<string, unknown>>();
  puts: Record<string, unknown>[] = [];

  private key(item: Record<string, unknown>): string {
    return `${String(item.PK)}|${String(item.SK)}`;
  }

  /** Pre-load an item under a PK/SK key. */
  seed(key: { PK: string; SK: string }, item: Record<string, unknown>): void {
    this.store.set(`${key.PK}|${key.SK}`, { ...key, ...item });
  }

  async send(command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }): Promise<unknown> {
    const name = command.constructor.name;
    const input = command.input;

    if (name === 'PutCommand') {
      const item = input.Item as Record<string, unknown>;
      // Honor a write-once condition if present.
      if (
        typeof input.ConditionExpression === 'string' &&
        input.ConditionExpression.includes('attribute_not_exists') &&
        this.store.has(this.key(item))
      ) {
        const err = new Error('ConditionalCheckFailedException');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      this.puts.push(item);
      this.store.set(this.key(item), item);
      return {};
    }

    if (name === 'GetCommand') {
      const k = input.Key as Record<string, unknown>;
      return { Item: this.store.get(`${String(k.PK)}|${String(k.SK)}`) };
    }

    if (name === 'QueryCommand') {
      const vals = (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
      const ascending = input.ScanIndexForward !== false;

      // GSI1 query (by GSI1PK).
      if (input.IndexName === 'GSI1') {
        const items = [...this.store.values()]
          .filter((i) => i.GSI1PK === vals[':pk'])
          .sort((a, b) => cmp(String(a.GSI1SK), String(b.GSI1SK), ascending));
        return { Items: items };
      }

      // Base table query (PK, optional SK begins_with).
      const items = [...this.store.values()]
        .filter(
          (i) =>
            i.PK === vals[':pk'] &&
            (!vals[':sk'] || String(i.SK).startsWith(String(vals[':sk']))),
        )
        .sort((a, b) => cmp(String(a.SK), String(b.SK), ascending));
      return { Items: items };
    }

    throw new Error(`FakeDynamo: unexpected command ${name}`);
  }
}

function cmp(a: string, b: string, ascending: boolean): number {
  const r = a < b ? -1 : a > b ? 1 : 0;
  return ascending ? r : -r;
}
