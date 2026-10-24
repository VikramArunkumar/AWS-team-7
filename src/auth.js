// CareBridge demo auth — FRONTEND ONLY, NO BACKEND.
//
// This is a client-side mock of sign-in and role routing (FR-1–FR-4). It does
// NOT authenticate against any server and provides NO real security. Frontend
// routing only hides screens; per AGENTS.md, "Hiding controls is not
// authorization." Real authentication and role enforcement must come from the
// backend (e.g. Amazon Cognito + authorized API checks) and are out of scope
// here. All accounts below are synthetic demo personas.

const STORAGE_KEY = 'carebridge.demoSession';

// Seeded synthetic accounts. Any password is accepted in this demo; the
// password field exists to resemble a real sign-in, not to validate secrets.
export const demoAccounts = [
  {
    email: 'olivia@westbrook.demo',
    password: 'demo',
    name: 'Olivia Bennett',
    initials: 'OB',
    role: 'charge-nurse',
    roleLabel: 'Charge nurse',
    roleTone: 'teal',
    unit: 'Medical–Surgical · Unit 4 West',
  },
  {
    email: 'sarah@westbrook.demo',
    password: 'demo',
    name: 'Sarah Chen',
    initials: 'SC',
    role: 'nurse',
    roleLabel: 'Nurse',
    roleTone: 'amber',
    unit: 'Medical–Surgical · Unit 4 West',
  },
  {
    email: 'admin@westbrook.demo',
    password: 'demo',
    name: 'Riley Adams',
    initials: 'RA',
    role: 'admin',
    roleLabel: 'Administrator',
    roleTone: 'green',
    unit: 'Westbrook Medical · System administration',
  },
];

// Strip the password before anything touches app state or storage.
function toSession(account) {
  const { password, ...session } = account;
  return session;
}

// Demo "sign in": match an email, accept any non-empty password. Returns the
// session (without password) or throws a user-facing error. No network call.
export function signIn(email, password) {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized || !password) {
    throw new Error('Enter an email and password to continue.');
  }
  const account = demoAccounts.find((entry) => entry.email === normalized);
  if (!account) {
    throw new Error('No demo account matches that email. Use a quick sign-in below.');
  }
  const session = toSession(account);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage may be unavailable (private mode); in-memory session still works.
  }
  return session;
}

export function signOut() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// Restore a session from a previous page load, if any. Validates that the
// stored role still maps to a known demo account so stale data can't inject a role.
export function getCurrentUser() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    const known = demoAccounts.some(
      (entry) => entry.email === session.email && entry.role === session.role,
    );
    return known ? session : null;
  } catch {
    return null;
  }
}
