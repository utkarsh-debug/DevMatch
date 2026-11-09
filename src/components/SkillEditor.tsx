'use client';

import { useRef, useState } from 'react';
import { LEVELS, type SkillRow } from '@/lib/types';

/** Add / remove skill rows. Inputs are uncontrolled and submitted as repeated skill_name / skill_level fields. */
export function SkillEditor({ initial, suggestions }: { initial: SkillRow[]; suggestions: string[] }) {
  const counter = useRef(0);
  const nextKey = () => counter.current++;
  const [rows, setRows] = useState(() =>
    (initial.length ? initial : [{ name: '', level: 'intermediate' as const }]).map((r) => ({ ...r, key: nextKey() })),
  );

  return (
    <div>
      {rows.map((r) => (
        <div className="skill-row" key={r.key}>
          <input
            type="text"
            name="skill_name"
            defaultValue={r.name}
            list="skill-list"
            placeholder="e.g. python"
            maxLength={50}
            aria-label="Skill"
          />
          <select name="skill_level" defaultValue={r.level} aria-label="Proficiency">
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn small danger"
            aria-label="Remove skill"
            onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn small"
        onClick={() => setRows((rs) => [...rs, { name: '', level: 'intermediate', key: nextKey() }])}
      >
        + Add skill
      </button>
      <datalist id="skill-list">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
