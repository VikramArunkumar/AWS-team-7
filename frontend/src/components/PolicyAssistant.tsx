/**
 * Policy assistant panel.
 *
 * Asks the Bedrock Knowledge Base about facility outage procedures and shows a
 * concise answer with its source citation. When no supporting policy is found
 * it clearly says so and recommends contacting the charge nurse or supervisor —
 * it never presents an invented policy.
 */

import { useState } from 'react';
import { askPolicy } from '../api/dashboardData.ts';
import type { PolicyAnswer } from '../types.ts';

const SUGGESTIONS = [
  'What do I do during an EHR outage?',
  'How do I handle medications when the eMAR is down?',
  'How should I escalate an urgent issue if paging is down?',
  'How do I document care on paper?',
  'What are the steps for a staffing shortage?',
];

export function PolicyAssistant(): JSX.Element {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<PolicyAnswer | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(q: string): Promise<void> {
    const text = q.trim();
    if (!text) return;
    setLoading(true);
    setAnswer(null);
    try {
      setAnswer(await askPolicy(text));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="policy">
      <h2>Policy assistant</h2>
      <p className="muted">
        Answers about outage procedures, grounded in facility policy documents. Informational only,
        not a clinical directive.
      </p>

      <form
        className="policy-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <input
          type="text"
          value={question}
          placeholder="Ask about an outage procedure…"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Searching…' : 'Ask'}
        </button>
      </form>

      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            className="chip"
            onClick={() => {
              setQuestion(s);
              void ask(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {answer ? (
        answer.hasSupport ? (
          <div className="policy-answer">
            <p>{answer.answer}</p>
            <div className="citations">
              <span className="citations-label">Source{answer.citations.length > 1 ? 's' : ''}:</span>
              {answer.citations.map((c) => (
                <span key={c.s3Uri} className="citation" title={c.snippet}>
                  📄 {c.title}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="policy-answer no-policy">
            <p>{answer.answer}</p>
            {answer.recommendation ? <p className="recommend">{answer.recommendation}</p> : null}
          </div>
        )
      ) : null}
    </section>
  );
}
