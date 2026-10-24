/**
 * Policy assistant service (task 6.3).
 *
 * Answers questions about facility outage procedures using an Amazon Bedrock
 * Knowledge Base backed by the synthetic policy documents in S3, via the
 * RetrieveAndGenerate API.
 *
 * Anti-fabrication contract: the assistant must NEVER invent hospital policy.
 * If the Knowledge Base returns no relevant citations, we discard any generated
 * text and return a fixed "no matching policy" answer that recommends contacting
 * the charge nurse or supervisor. A grounded answer is only returned when it is
 * backed by at least one citation.
 *
 * Env (read at call time): KB_ID, KB_MODEL_ARN. Set POLICY_MOCK=1 for offline dev.
 */

import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
  type RetrieveAndGenerateCommandInput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import type { Citation, PolicyAnswer } from './types.ts';

export const NO_POLICY_ANSWER =
  'No matching facility policy was found for this question.';
export const NO_POLICY_RECOMMENDATION =
  'Please contact the charge nurse or nursing supervisor for guidance.';

function kbId(): string {
  return process.env.KB_ID ?? '';
}
function kbModelArn(): string {
  return process.env.KB_MODEL_ARN ?? '';
}
function isMock(): boolean {
  return process.env.POLICY_MOCK === '1';
}

let client: BedrockAgentRuntimeClient | undefined;

function getClient(): BedrockAgentRuntimeClient {
  if (!client) client = new BedrockAgentRuntimeClient({});
  return client;
}

/** Test seam: inject a mock agent-runtime client. */
export function setClient(c: BedrockAgentRuntimeClient): void {
  client = c;
}

/** The fixed response used whenever there is no reliable supporting policy. */
export function noPolicyAnswer(): PolicyAnswer {
  return {
    answer: NO_POLICY_ANSWER,
    citations: [],
    hasSupport: false,
    recommendation: NO_POLICY_RECOMMENDATION,
  };
}

/** Derive a readable title + S3 uri from a retrieved reference location. */
function toCitation(
  s3Uri: string | undefined,
  snippet: string,
): Citation | undefined {
  if (!s3Uri) return undefined;
  const name = s3Uri.split('/').pop() ?? s3Uri;
  const title = name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  return { title, s3Uri, snippet: snippet.slice(0, 400) };
}

/**
 * Parse the RetrieveAndGenerate response into citations. Returns an empty array
 * when nothing relevant was retrieved.
 */
function extractCitations(response: unknown): Citation[] {
  const citations = (response as {
    citations?: Array<{
      retrievedReferences?: Array<{
        content?: { text?: string };
        location?: { s3Location?: { uri?: string } };
      }>;
    }>;
  })?.citations;
  if (!Array.isArray(citations)) return [];

  const out: Citation[] = [];
  for (const c of citations) {
    for (const ref of c.retrievedReferences ?? []) {
      const citation = toCitation(ref.location?.s3Location?.uri, ref.content?.text ?? '');
      if (citation) out.push(citation);
    }
  }
  return out;
}

function mockAnswer(question: string): PolicyAnswer {
  const q = question.toLowerCase();
  // Only return a grounded mock answer for topics we actually have docs for;
  // otherwise exercise the no-policy path so the guardrail stays honest.
  const topics: Array<{ match: RegExp; file: string; answer: string }> = [
    {
      match: /ehr|record/,
      file: 'ehr-outage-procedure.md',
      answer:
        'During an EHR outage, continue essential care and capture updates in CareBridge or approved downtime forms, recording original observation times. The charge nurse declares and later resolves the outage.',
    },
    {
      match: /medication|emar|dose|drug/,
      file: 'medication-system-outage-procedure.md',
      answer:
        'Use the most recent verified medication record to confirm what is due. If prior dose timing cannot be confirmed, do not re-dose; escalate to the charge nurse and prescriber. CareBridge never changes medication orders.',
    },
    {
      match: /escalat|communicat|paging|message/,
      file: 'communication-escalation-procedure.md',
      answer:
        'Use the fallback communication order (in-person, then unit methods, with the charge nurse as coordination point). Urgent items go directly to the charge nurse; emergencies use the standard code process.',
    },
    {
      match: /document|paper|chart/,
      file: 'manual-documentation-procedure.md',
      answer:
        'Document on approved downtime forms or CareBridge with legible, signed, time-stamped entries at the actual observation time. Never erase; append corrections as new entries. Reconcile into the EHR on recovery.',
    },
    {
      match: /staff|coverage|ratio|call-out/,
      file: 'staffing-disruption-procedure.md',
      answer:
        'Rebalance assignments by acuity, request float/resource staff, prioritize time-critical care, and escalate to the nursing supervisor if a safe ratio cannot be met. The charge nurse approves every assignment.',
    },
  ];

  const hit = topics.find((t) => t.match.test(q));
  if (!hit) return noPolicyAnswer();
  return {
    answer: `${hit.answer} (synthetic policy)`,
    citations: [
      {
        title: hit.file.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        s3Uri: `s3://carebridge-policies/${hit.file}`,
        snippet: 'Synthetic policy document excerpt (mock mode).',
      },
    ],
    hasSupport: true,
  };
}

/**
 * Answer a policy question. Never fabricates: returns a grounded answer only
 * when the Knowledge Base supplies at least one citation, otherwise the
 * no-policy response.
 */
export async function askPolicy(question: string): Promise<PolicyAnswer> {
  if (isMock()) return mockAnswer(question);

  const knowledgeBaseId = kbId();
  const modelArn = kbModelArn();
  if (!knowledgeBaseId || !modelArn) {
    // Not configured: fail safe to the no-policy response rather than guessing.
    return noPolicyAnswer();
  }

  const input: RetrieveAndGenerateCommandInput = {
    input: { text: question },
    retrieveAndGenerateConfiguration: {
      type: 'KNOWLEDGE_BASE',
      knowledgeBaseConfiguration: {
        knowledgeBaseId,
        modelArn,
      },
    },
  };

  let response: unknown;
  try {
    response = await getClient().send(new RetrieveAndGenerateCommand(input));
  } catch {
    // Treat KB/model errors as "no reliable policy" rather than inventing one.
    return noPolicyAnswer();
  }

  const citations = extractCitations(response);
  const generated = (response as { output?: { text?: string } })?.output?.text?.trim() ?? '';

  // No citations => no reliable grounding => do not return generated text.
  if (citations.length === 0 || generated === '') {
    return noPolicyAnswer();
  }

  return { answer: generated, citations, hasSupport: true };
}
