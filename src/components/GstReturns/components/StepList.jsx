import React, { useState } from 'react';
import { CheckCircle, ChevronDown, ChevronRight } from 'lucide-react';

export default function StepList({ steps, title }) {
  const [expanded, setExpanded] = useState({});
  const [checked, setChecked] = useState({});
  return (
    <div className="glass-panel mb-4">
      <div className="table-header"><h3>{title}</h3></div>
      <div style={{ padding: '0.5rem 0' }}>
        {steps.map((step, i) => (
          <div key={i} style={{ borderBottom: i < steps.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 1.25rem', cursor: 'pointer' }} onClick={() => setExpanded(p => ({ ...p, [i]: !p[i] }))}>
              <button className="icon-btn" onClick={e => { e.stopPropagation(); setChecked(p => ({ ...p, [i]: !p[i] })); }}
                style={{ color: checked[i] ? '#059669' : 'var(--text-muted)', background: checked[i] ? '#ecfdf5' : 'transparent', width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle size={16} />
              </button>
              <span style={{ flex: 1, fontWeight: 600, fontSize: '0.85rem', color: checked[i] ? '#059669' : 'var(--text)', textDecoration: checked[i] ? 'line-through' : 'none' }}>
                Step {i + 1}: {step.title}
              </span>
              {expanded[i] ? <ChevronDown size={14} color="var(--text-muted)" /> : <ChevronRight size={14} color="var(--text-muted)" />}
            </div>
            {expanded[i] && (
              <div style={{ padding: '0 1.25rem 0.75rem 3.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{step.details}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}