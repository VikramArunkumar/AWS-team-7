// Synthetic facility policy fixtures — FRONTEND ONLY, NO BACKEND.
//
// These are fictional, authored policy excerpts for the demo. There is NO
// Bedrock Knowledge Base, NO retrieval service, and NO network call. The
// policy assistant answers by matching a question's keywords against these
// local records. Per AGENTS.md, the UI must cite only the documents that
// actually exist here and must never fabricate a citation or procedure.
//
// Each policy carries a stable document id so the UI can cite a real source.
// Keep these clearly marked as synthetic demonstration content.

export const policyLibraryLabel = 'Synthetic demo policies · not a Bedrock Knowledge Base';

export const policies = [
  {
    id: 'POL-DT-01',
    title: 'Downtime Documentation Procedure',
    section: 'Section 2 · Paper documentation during system outages',
    reference: 'Westbrook Downtime Manual, POL-DT-01',
    keywords: ['document', 'documentation', 'chart', 'charting', 'paper', 'form', 'forms', 'record', 'ehr', 'outage', 'downtime', 'write'],
    summary:
      'During an EHR or software outage, record patient care on the approved paper downtime forms. Note the date, time, patient identifier, and your name on every entry. Back-enter the information into the electronic record once systems are restored, marking it as downtime documentation.',
  },
  {
    id: 'POL-MED-04',
    title: 'Medication Administration During Downtime',
    section: 'Section 4 · Verifying medications without the eMAR',
    reference: 'Westbrook Downtime Manual, POL-MED-04',
    keywords: ['medication', 'medications', 'med', 'meds', 'emar', 'mar', 'administer', 'administration', 'dose', 'dosage', 'verify', 'drug'],
    summary:
      'When the electronic medication record is unavailable, verify each medication against the most recent printed medication list and a second licensed nurse before administration. Document the administration on the paper downtime medication form and reconcile with the eMAR after recovery.',
  },
  {
    id: 'POL-HO-02',
    title: 'Shift Handoff and Continuity Reporting',
    section: 'Section 3 · Structured handoff during coordination incidents',
    reference: 'Westbrook Continuity Policy, POL-HO-02',
    keywords: ['handoff', 'hand-off', 'handover', 'shift', 'report', 'continuity', 'transfer', 'sbar', 'change'],
    summary:
      'Use a structured handoff (identification, situation, background, assessment, recommendation) for every shift change during an incident. Confirm receipt with the receiving nurse and record outstanding tasks, unverified information, and pending follow-ups in the continuity log.',
  },
  {
    id: 'POL-ESC-03',
    title: 'Escalation and Supervisor Notification',
    section: 'Section 5 · When and how to escalate',
    reference: 'Westbrook Incident Policy, POL-ESC-03',
    keywords: ['escalate', 'escalation', 'supervisor', 'charge', 'notify', 'notification', 'urgent', 'emergency', 'contact', 'help'],
    summary:
      'Escalate to the charge nurse for unresolved time-sensitive tasks, and to the nursing supervisor for safety concerns, staffing shortfalls, or unavailable critical resources. Record the escalation, the time, and the person notified in the incident log.',
  },
  {
    id: 'POL-SUP-05',
    title: 'Supply Shortage Reporting',
    section: 'Section 6 · Requesting supplies during an outage',
    reference: 'Westbrook Downtime Manual, POL-SUP-05',
    keywords: ['supply', 'supplies', 'form', 'forms', 'stock', 'shortage', 'request', 'inventory', 'equipment', 'low'],
    summary:
      'Report low or depleted supplies, including printed downtime forms, to the charge nurse and submit a supply request through the unit coordinator. Note the station, item, and quantity needed so requests can be prioritized during the incident.',
  },
];

// Common words that must never drive a policy match, so questions like
// "what's for lunch" fall through to the honest no-evidence state (FR-29).
const stopwords = new Set([
  'the', 'and', 'for', 'with', 'what', 'whats', 'how', 'why', 'when', 'where',
  'who', 'can', 'should', 'would', 'could', 'may', 'does', 'did', 'are', 'was',
  'this', 'that', 'these', 'those', 'you', 'your', 'our', 'their', 'from',
  'into', 'about', 'during', 'need', 'want', 'get', 'got', 'have', 'has',
]);

// Match a query term to a keyword only on a whole-word basis: exact, or a
// simple singular/plural difference (form/forms, med/meds). This avoids loose
// substring false positives such as "for" matching the keyword "form".
function termMatchesKeyword(term, keyword) {
  if (term === keyword) return true;
  if (term === keyword + 's' || term + 's' === keyword) return true;
  return false;
}

// Simple local keyword match — NO AI, NO network. Returns matching policies
// ranked by how many distinct query terms they hit. Returns [] when nothing
// matches so the UI can show an honest no-evidence state (FR-29) instead of guessing.
export function findPolicies(query) {
  const terms = (query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2 && !stopwords.has(term));
  if (!terms.length) return [];
  const scored = policies
    .map((policy) => {
      const score = terms.reduce(
        (total, term) => total + (policy.keywords.some((kw) => termMatchesKeyword(term, kw)) ? 1 : 0),
        0,
      );
      return { policy, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.policy);
}
