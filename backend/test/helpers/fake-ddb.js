// In-memory stand-in for the DynamoDB DocumentClient used by the handlers.
//
// Supports the commands and expression features this codebase uses: Put, Get,
// Update, Delete, Query (PK equality), TransactWrite; conditions with
// attribute_exists / attribute_not_exists / = / <> / AND / OR / NOT /
// parentheses; SET with plain values, list_append, if_not_exists; REMOVE.
// Anything else throws, so a test can never pass against semantics the fake
// does not implement. This is a unit-test double, not a DynamoDB emulator.

const keyOf = (key) => `${key.PK}\u0000${key.SK}`;
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function awsError(name) {
  const err = new Error(name);
  err.name = name;
  return err;
}

// ---- expression parsing ----------------------------------------------------
const TOKEN = /\s*(\(|\)|,|<>|=|[#:]?[A-Za-z_][A-Za-z0-9_]*)/y;

function tokenize(expr) {
  const tokens = [];
  let pos = 0;
  while (expr.slice(pos).trim()) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(expr);
    if (!m) throw new Error(`fake-ddb: cannot parse "${expr}" at ${pos}`);
    tokens.push(m[1]);
    pos = TOKEN.lastIndex;
  }
  return tokens;
}

function attrName(token, names) {
  if (token.startsWith('#')) {
    if (!(token in (names ?? {}))) throw new Error(`fake-ddb: missing name ${token}`);
    return names[token];
  }
  if (token.startsWith(':')) throw new Error(`fake-ddb: expected attribute, got ${token}`);
  return token;
}

function operand(token, item, names, values) {
  if (token.startsWith(':')) {
    if (!(token in (values ?? {}))) throw new Error(`fake-ddb: missing value ${token}`);
    return values[token];
  }
  return item?.[attrName(token, names)];
}

export function evaluateCondition(expr, item, names, values) {
  if (!expr) return true;
  const t = tokenize(expr);
  let i = 0;
  const peek = () => t[i];
  const take = (expected) => {
    const tok = t[i++];
    if (expected && tok !== expected) throw new Error(`fake-ddb: expected ${expected} in "${expr}"`);
    return tok;
  };
  const isKeyword = (tok, kw) => tok?.toUpperCase() === kw;

  function parseOr() {
    let left = parseAnd();
    while (isKeyword(peek(), 'OR')) { take(); const right = parseAnd(); left = left || right; }
    return left;
  }
  function parseAnd() {
    let left = parseNot();
    while (isKeyword(peek(), 'AND')) { take(); const right = parseNot(); left = left && right; }
    return left;
  }
  function parseNot() {
    if (isKeyword(peek(), 'NOT')) { take(); return !parseNot(); }
    return parsePrimary();
  }
  function parsePrimary() {
    const tok = take();
    if (tok === '(') { const v = parseOr(); take(')'); return v; }
    if (tok === 'attribute_exists' || tok === 'attribute_not_exists') {
      take('(');
      const name = attrName(take(), names);
      take(')');
      const exists = item !== undefined && item[name] !== undefined;
      return tok === 'attribute_exists' ? exists : !exists;
    }
    const left = operand(tok, item, names, values);
    const op = take();
    const right = operand(take(), item, names, values);
    if (op === '=') return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
    if (op === '<>') return JSON.stringify(left) !== JSON.stringify(right);
    throw new Error(`fake-ddb: unsupported operator ${op}`);
  }

  const result = parseOr();
  if (i !== t.length) throw new Error(`fake-ddb: trailing tokens in "${expr}"`);
  return result;
}

function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function applyUpdate(expr, item, names, values) {
  const sections = expr.split(/\b(SET|REMOVE)\b/).map((s) => s.trim()).filter(Boolean);
  for (let s = 0; s < sections.length; s += 2) {
    const kind = sections[s];
    const body = sections[s + 1];
    if (kind === 'SET') {
      for (const clause of splitTopLevel(body)) {
        const eq = clause.indexOf('=');
        const lhs = attrName(clause.slice(0, eq).trim(), names);
        const rhs = clause.slice(eq + 1).trim();
        const fn = /^(list_append|if_not_exists)\(\s*([#:]?\w+)\s*,\s*([#:]?\w+)\s*\)$/.exec(rhs);
        if (fn) {
          const a = operand(fn[2], item, names, values);
          const b = operand(fn[3], item, names, values);
          item[lhs] = fn[1] === 'list_append' ? [...(a ?? []), ...b] : (a !== undefined ? a : b);
        } else if (/^[#:]?\w+$/.test(rhs)) {
          item[lhs] = clone(operand(rhs, item, names, values));
        } else {
          throw new Error(`fake-ddb: unsupported SET clause "${clause}"`);
        }
      }
    } else if (kind === 'REMOVE') {
      for (const name of splitTopLevel(body)) delete item[attrName(name, names)];
    } else {
      throw new Error(`fake-ddb: unsupported update section ${kind}`);
    }
  }
}

// ---- store -----------------------------------------------------------------
export function createFakeDdb() {
  const store = new Map();
  const get = (key) => store.get(keyOf(key));

  function put({ Item, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues }) {
    if (!evaluateCondition(ConditionExpression, get(Item), ExpressionAttributeNames, ExpressionAttributeValues)) {
      return false;
    }
    store.set(keyOf(Item), clone(Item));
    return true;
  }

  function update({ Key, UpdateExpression, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues }) {
    const existing = get(Key);
    if (!evaluateCondition(ConditionExpression, existing, ExpressionAttributeNames, ExpressionAttributeValues)) {
      return null;
    }
    const next = clone(existing) ?? { ...Key };
    applyUpdate(UpdateExpression, next, ExpressionAttributeNames, ExpressionAttributeValues);
    store.set(keyOf(Key), next);
    return next;
  }

  function del({ Key, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues }) {
    if (!evaluateCondition(ConditionExpression, get(Key), ExpressionAttributeNames, ExpressionAttributeValues)) {
      return false;
    }
    store.delete(keyOf(Key));
    return true;
  }

  function checkOnly(op) {
    const [kind, input] = Object.entries(op)[0];
    const key = kind === 'Put' ? input.Item : input.Key;
    return evaluateCondition(input.ConditionExpression, get(key),
      input.ExpressionAttributeNames, input.ExpressionAttributeValues);
  }

  function transactWrite({ TransactItems }) {
    // All conditions are evaluated against the pre-transaction state first.
    const results = TransactItems.map(checkOnly);
    if (results.some((okay) => !okay)) {
      const err = awsError('TransactionCanceledException');
      err.CancellationReasons = results.map((okay) => ({ Code: okay ? 'None' : 'ConditionalCheckFailed' }));
      throw err;
    }
    for (const op of TransactItems) {
      if (op.Put) put({ ...op.Put, ConditionExpression: undefined });
      else if (op.Update) update({ ...op.Update, ConditionExpression: undefined });
      else if (op.Delete) del({ ...op.Delete, ConditionExpression: undefined });
      else throw new Error('fake-ddb: unsupported transaction item');
    }
  }

  async function send(command) {
    const name = command?.constructor?.name;
    const input = command?.input ?? {};
    switch (name) {
      case 'PutCommand':
        if (!put(input)) throw awsError('ConditionalCheckFailedException');
        return {};
      case 'GetCommand':
        return { Item: clone(get(input.Key)) };
      case 'UpdateCommand': {
        const next = update(input);
        if (!next) throw awsError('ConditionalCheckFailedException');
        return input.ReturnValues === 'ALL_NEW' ? { Attributes: clone(next) } : {};
      }
      case 'DeleteCommand':
        if (!del(input)) throw awsError('ConditionalCheckFailedException');
        return {};
      case 'TransactWriteCommand':
        transactWrite(input);
        return {};
      case 'QueryCommand': {
        if (input.KeyConditionExpression !== 'PK = :pk') {
          throw new Error(`fake-ddb: unsupported query ${input.KeyConditionExpression}`);
        }
        const pk = input.ExpressionAttributeValues[':pk'];
        const Items = [...store.values()].filter((i) => i.PK === pk).map(clone);
        return { Items, LastEvaluatedKey: undefined };
      }
      default:
        throw new Error(`fake-ddb: unsupported command ${name}`);
    }
  }

  return {
    send,
    transactWrite,
    seed(items) { for (const item of items) store.set(keyOf(item), clone(item)); },
    get: (key) => clone(get(key)),
    all: () => [...store.values()].map(clone),
  };
}
