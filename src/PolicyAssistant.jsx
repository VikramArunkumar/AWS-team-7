import React, { useState } from 'react';
import { ArrowRight, BookOpen, FileText, TriangleAlert, ShieldCheck, Search } from 'lucide-react';
import { findPolicies, policyLibraryLabel } from './policies.js';

// Policy assistant — FRONTEND ONLY, NO BACKEND.
//
// Answers facility-procedure questions (FR-26) by matching keywords against
// synthetic local policy fixtures. Shows citations to the actual fixture
// documents used (FR-28) and an honest no-evidence state when nothing matches
// (FR-29). There is NO Bedrock Knowledge Base and NO network call; per
// AGENTS.md, it cites only documents that exist and never fabricates one.
export default function PolicyAssistant() {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null); // null = not asked yet

  const ask = (event) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    const matches = findPolicies(trimmed);
    setResult({ question: trimmed, matches });
  };

  const hasAnswer = result && result.matches.length > 0;
  const noEvidence = result && result.matches.length === 0;

  return (
    <section className="panel policy-panel">
      <span className="policy-symbol"><BookOpen size={30} /></span>
      <span className="badge teal">Policy assistant · demo</span>
      <h2>Reliable answers start with your policies.</h2>
      <p>
        Ask about facility downtime procedures. Answers are drawn from synthetic demonstration
        policies and cite the source document. Verify against current facility policy before acting.
      </p>

      <form className="policy-input" onSubmit={ask}>
        <label className="sr-only" htmlFor="policy-question">Your question</label>
        <input
          id="policy-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="How do I document care during an EHR outage?"
        />
        <button className="primary-button" type="submit" aria-label="Ask the policy assistant">
          <ArrowRight size={18} />
        </button>
      </form>
      <small>
        {policyLibraryLabel}. This demo matches keywords against local synthetic policies; it does
        not use a Bedrock Knowledge Base or any backend service.
      </small>

      {hasAnswer && (
        <div className="policy-answer" role="region" aria-label="Policy answer">
          <span className="eyebrow"><BookOpen size={12} /> ANSWER FROM SYNTHETIC POLICY · VERIFY BEFORE ACTING</span>
          {result.matches.map((policy) => (
            <article className="policy-result" key={policy.id}>
              <h3>{policy.title}</h3>
              <p>{policy.summary}</p>
              <div className="policy-citation">
                <FileText size={14} />
                <span>
                  <strong>{policy.reference}</strong>
                  <small>{policy.section}</small>
                </span>
              </div>
            </article>
          ))}
          <p className="policy-disclaimer">
            <ShieldCheck size={13} /> Synthetic demonstration content. Citations refer to fictional
            facility documents. Confirm the current procedure with your facility before acting.
          </p>
        </div>
      )}

      {noEvidence && (
        <div className="policy-empty" role="region" aria-label="No policy found">
          <TriangleAlert size={20} />
          <div>
            <strong>No relevant policy found</strong>
            <p>
              No synthetic policy matched “{result.question}”. No answer or citation is shown rather
              than guessing. Try different wording, or consult your facility's policy directly.
            </p>
          </div>
        </div>
      )}

      {!result && (
        <div className="policy-hint">
          <Search size={14} />
          <span>Try: documentation, medications, handoff, escalation, or supplies.</span>
        </div>
      )}
    </section>
  );
}
