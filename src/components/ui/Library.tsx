// Left column: the catalog to drag onto the bench (a tile each, its description on hover), and the
// deck's outline.
import { Box, Diamond, FlaskConical, Grid3x3, House, LayoutPanelLeft, MapPin, Scale, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Finding } from '../../lib/checks';
import { CATALOG, slotCount, type ComponentKind } from '../../lib/deck';
import { useStore } from '../../state';

export const DRAG_TYPE = 'application/x-arm-loc-helper';

const KIND_ICON: Record<ComponentKind, ReactNode> = {
  tray: <Grid3x3 size={15} />,
  station: <Scale size={15} />,
  side_rack: <LayoutPanelLeft size={15} />,
  block: <Box size={15} />,
};

const CARD_ICON: Record<string, ReactNode> = {
  vial_tray: <Grid3x3 size={18} />,
  well_plate: <FlaskConical size={18} />,
  station: <Scale size={18} />,
  side_rack: <LayoutPanelLeft size={18} />,
  block: <Box size={18} />,
  safe_point: <Diamond size={18} />,
};

export function Library({ onAdd, findings }: { onAdd: (key: string) => void; findings: Finding[] }) {
  const { project, selection, select, update } = useStore();
  const count = (id: string) => findings.filter((f) => f.target === id && f.level !== 'tip').length;
  const cards = [...CATALOG.map((e) => ({ key: e.key, label: e.label, hint: e.hint })),
    { key: 'safe_point', label: 'Safe point', hint: 'Free space the arm travels through between stations.' }];
  // the hint floats beside the tile, fixed to the window so the column's scrolling does not clip it
  const [tip, setTip] = useState<{ key: string; hint: string; left: number; top: number } | null>(null);
  const showTip = (key: string, hint: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const beside = r.right + 8 + 230 < window.innerWidth;
    setTip({ key, hint, left: beside ? r.right + 8 : Math.max(8, r.left), top: beside ? r.top : r.bottom + 6 });
  };

  return (
    <aside className="column left">
      <div className="panel-title">Components</div>
      <div className="catalog">
        {cards.map((c) => (
          <button key={c.key} className="card" draggable aria-describedby={tip?.key === c.key ? 'catalog-tip' : undefined}
            onMouseEnter={(e) => showTip(c.key, c.hint, e.currentTarget)} onMouseLeave={() => setTip(null)}
            onFocus={(e) => showTip(c.key, c.hint, e.currentTarget)} onBlur={() => setTip(null)}
            onDragStart={(e) => { setTip(null); e.dataTransfer.setData(DRAG_TYPE, c.key); e.dataTransfer.effectAllowed = 'copy'; }}
            onClick={() => onAdd(c.key)}>
            <span className="card-icon">{CARD_ICON[c.key]}</span>
            <strong>{c.label}</strong>
          </button>
        ))}
      </div>
      {tip && (
        <div id="catalog-tip" role="tooltip" className="tooltip" style={{ left: tip.left, top: tip.top }}>
          {tip.hint}<span className="tooltip-how">Drag onto the bench, or click to add.</span>
        </div>
      )}

      <div className="panel-title">Deck <span className="muted">{project.components.length + project.safePoints.length}</span></div>
      <ul className="outline">
        {project.components.map((c) => {
          const n = count(c.id);
          return (
            <li key={c.id}>
              <button className={selection?.type === 'component' && selection.id === c.id ? 'active' : ''} onClick={() => select({ type: 'component', id: c.id })}>
                {KIND_ICON[c.kind]}<span className="grow">{c.label}</span>
                {slotCount(c) > 1 && <span className="muted small">{slotCount(c)}</span>}
                {n > 0 && <span className="badge error">{n}</span>}
              </button>
            </li>
          );
        })}
        {project.safePoints.map((s) => {
          const n = count(s.id);
          return (
            <li key={s.id}>
              <button className={selection?.type === 'safe' && selection.id === s.id ? 'active' : ''} onClick={() => select({ type: 'safe', id: s.id })}>
                {s.id === project.home ? <House size={15} /> : <Diamond size={15} />}<span className="grow">{s.label}</span>
                {n > 0 && <span className="badge error">{n}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {project.waypoints.length > 0 && (
        <>
          <div className="panel-title">
            {project.script?.fileName ?? 'Waypoints'} <span className="muted">{project.waypoints.length}</span>
            <button className="icon-btn" title="Forget the imported waypoints"
              onClick={() => update((p) => ({ ...p, waypoints: [], script: undefined }))}><Trash2 size={14} /></button>
          </div>
          <ul className="outline">
            {project.waypoints.map((w) => (
              <li key={w.name}>
                <button className={selection?.type === 'waypoint' && selection.id === w.name ? 'active' : ''} onClick={() => select({ type: 'waypoint', id: w.name })}>
                  <MapPin size={15} /><span className="grow mono">{w.name}</span><span className="muted small">{w.pose ? 'p' : ''}{w.q ? 'q' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
