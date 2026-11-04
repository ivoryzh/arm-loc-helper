// Small form controls for the inspector. Numbers are edited in display units (mm, degrees) and
// stored in the project's (metres, degrees, radians).
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  scale?: number;      // display = value * scale
  unit?: string;
  digits?: number;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  disabled?: boolean;
  title?: string;
}

export function NumberField({ label, value, onChange, scale = 1, unit, digits = 1, step, min, max, integer, disabled, title }: NumberFieldProps) {
  const shown = (v: number) => (integer ? String(Math.round(v * scale)) : String(+(v * scale).toFixed(digits)));
  const [text, setText] = useState(shown(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown(value));
  }, [value, scale, digits]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (t: string) => {
    let v = Number(t);
    if (t.trim() === '' || !Number.isFinite(v)) return;
    if (integer) v = Math.round(v);
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v / scale);
  };
  return (
    <label className="field" title={title}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          value={text}
          step={step ?? (integer ? 1 : 'any')}
          disabled={disabled}
          onFocus={() => { focused.current = true; }}
          onBlur={() => { focused.current = false; setText(shown(value)); }}
          onChange={(e) => { setText(e.target.value); commit(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  );
}

export function TextField({ label, value, onChange, onCommit, placeholder, mono }: {
  label: string; value: string; onChange?: (v: string) => void; onCommit?: (v: string) => void; placeholder?: string; mono?: boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="field wide">
      <span className="field-label">{label}</span>
      <input
        className={mono ? 'mono' : undefined}
        value={text}
        placeholder={placeholder}
        onChange={(e) => { setText(e.target.value); onChange?.(e.target.value); }}
        onBlur={() => onCommit?.(text)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, wide = true }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head"><h3>{title}</h3>{aside}</header>
      <div className="section-body">{children}</div>
    </section>
  );
}

export const Row = ({ children }: { children: ReactNode }) => <div className="row">{children}</div>;
