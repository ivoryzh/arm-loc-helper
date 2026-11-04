// Right column, Checks tab: the recommendations, each with what to do about it.
import { AlertTriangle, CheckCircle2, Lightbulb, XCircle } from 'lucide-react';
import type { Finding } from '../../lib/checks';
import { useStore } from '../../state';

const ICON = {
  error: <XCircle size={16} />,
  warning: <AlertTriangle size={16} />,
  tip: <Lightbulb size={16} />,
};

export function ChecksPanel({ findings }: { findings: Finding[] }) {
  const { project, update, select } = useStore();
  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.filter((f) => f.level === 'warning').length;
  const goTo = (id?: string) => {
    if (!id) return;
    if (project.components.some((c) => c.id === id)) select({ type: 'component', id });
    else if (project.safePoints.some((s) => s.id === id)) select({ type: 'safe', id });
  };
  return (
    <div className="checks">
      <div className={`summary ${errors ? 'bad' : warnings ? 'warn' : 'ok'}`}>
        {errors ? <XCircle size={18} /> : warnings ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
        <span>
          {errors ? `${errors} problem${errors > 1 ? 's' : ''} to fix before exporting` : warnings ? `${warnings} thing${warnings > 1 ? 's' : ''} to look at` : 'Every slot and safe point is reachable, and every path is laid out.'}
        </span>
      </div>
      <ul className="findings">
        {findings.map((f, i) => (
          <li key={i} className={`finding ${f.level}`}>
            <span className="finding-icon">{ICON[f.level]}</span>
            <div className="finding-body">
              <button className="finding-title" onClick={() => goTo(f.target)} disabled={!f.target}>{f.title}</button>
              {f.detail && <p>{f.detail}</p>}
              {f.fix && <button className="btn small" onClick={() => update(f.fix!.apply)}>{f.fix.label}</button>}
            </div>
          </li>
        ))}
      </ul>
      <div className="muted small legend">
        <p><strong>How the checks think.</strong> Picking from a tray or a station is almost always perpendicular: the tool straight down, in and out vertically, so the fingers close square on the item. Racks you slide into are loaded along their rails, with the tool horizontal. Between stations the arm only travels through safe points you placed, so every path is one you laid out.</p>
      </div>
    </div>
  );
}
