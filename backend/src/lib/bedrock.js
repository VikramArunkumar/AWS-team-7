// Bedrock access behind a single interface (NFR-28: modular, independently
// testable). The real Converse API call is not wired up yet; this stub returns
// deterministic, clearly-labeled synthetic output so the persistence and
// approval flows can be built and tested without live AWS.
//
// When you implement the real path:
//   - Call Amazon Bedrock Converse with BEDROCK_MODEL_ID in BEDROCK_REGION.
//   - Configure Guardrails (NFR-12) and handle refusals / missing evidence.
//   - Validate the model's JSON before returning it (untrusted output).
//   - NEVER let model output overwrite source data (NFR-15); it is only ever
//     stored as a separate, proposed recommendation that a human must approve.
//
// Set BEDROCK_MODE=live (and implement callConverse) to switch over.

const MODE = process.env.BEDROCK_MODE || 'stub';

/**
 * Produce recommendations from a nurse update. Returns proposals only; the
 * caller persists them as REC items with status 'proposed'. Each proposal
 * cites the source update id (FR-22, NFR-23).
 *
 * @returns {{recommendations: Array<{title:string, reason:string, sourceUpdateIds:string[], aiGenerated:true}>}}
 */
export async function processUpdate({ update }) {
  if (MODE === 'live') {
    // TODO: implement real Bedrock Converse call + Guardrails + validation.
    throw new Error('Bedrock live mode not implemented yet.');
  }
  return stubProcessUpdate(update);
}

function stubProcessUpdate(update) {
  const urgentPrefix = update.urgent ? 'Urgent: ' : '';
  return {
    recommendations: [
      {
        title: `${urgentPrefix}Review "${truncate(update.category || 'update', 40)}" for ${update.patient}`,
        reason:
          'Synthetic demonstration recommendation. Derived only from the linked nurse update; ' +
          'no clinical inference was performed. Verify against the source before acting.',
        sourceUpdateIds: [update.id],
        aiGenerated: true,
      },
    ],
  };
}

function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
