import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, FilePlus2, FolderOpen, Moon, Move3d, Redo2, RotateCw, Save, Sparkles, Sun, Undo2, Upload } from 'lucide-react';
import { Scene, type GizmoMode, type Projector } from './components/3d/Scene';
import { CodePanel } from './components/ui/CodePanel';
import { ChecksPanel } from './components/ui/ChecksPanel';
import { Inspector } from './components/ui/Inspector';
import { DRAG_TYPE, Library } from './components/ui/Library';
import { MotionPanel } from './components/ui/MotionPanel';
import { Toggle } from './components/ui/fields';
import { checkProject } from './lib/checks';
import { CATALOG, emptyProject, makeComponent, makeSafePoint, slotMatrix, type Project } from './lib/deck';
import { demoProject } from './lib/demo';
import { nearest, ik, elbowUp, type Joints } from './lib/kinematics';
import { parseScript } from './lib/parser';
import { ROBOTS } from './lib/robots';
import { safePointJoints, tcpToFlange } from './lib/runtimeDeck';
import { download, normalizeProject, projectFileName } from './lib/storage';
import { waypointMatrix } from './lib/teach';
import { StoreProvider, useStore } from './state';
import './styles/App.css';

type Tab = 'inspect' | 'checks' | 'motion' | 'python';

function initialDark(): boolean {
  try {
    const saved = localStorage.getItem('arm-loc-helper/theme');
    if (saved) return saved === 'dark';
  } catch { /* no storage */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

function Editor() {
  const { project, selection, update, replace, select, undo, redo, canUndo, canRedo, arm } = useStore();
  const [tab, setTab] = useState<Tab>('inspect');
  const [mode, setMode] = useState<GizmoMode>('translate');
  const [snap, setSnap] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showPath, setShowPath] = useState(true);
  const [dark, setDark] = useState(initialDark);
  const [previewSlot, setPreviewSlot] = useState(0);
  const [itemsVersion, setItemsVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const projector = useRef<Projector | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const findings = useMemo(() => checkProject(project), [project]);
  const problems = findings.filter((f) => f.level === 'error').length;
  const params = ROBOTS[project.robot.model].params;
  const homePoint = project.safePoints.find((s) => s.id === project.home) ?? project.safePoints[0];
  const homeQ = useMemo(() => (homePoint ? safePointJoints(homePoint, project) : null), [homePoint, project]);
  const onItemsChanged = useCallback(() => setItemsVersion((v) => v + 1), []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('arm-loc-helper/theme', dark ? 'dark' : 'light'); } catch { /* fine */ }
  }, [dark]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // the arm shows the selected slot, safe point or waypoint (unless a preview is playing)
  useEffect(() => {
    const a = arm.current;
    if (a.player?.running) return;
    a.player = null;
    a.playing = false;
    let target: Joints | null = null;
    const solve = (tcp: number[]) => {
      const sols = ik(tcpToFlange(tcp, project), params);
      return homeQ ? nearest(sols, homeQ, elbowUp) ?? nearest(sols, homeQ) : null;
    };
    if (selection?.type === 'component') {
      const c = project.components.find((x) => x.id === selection.id);
      if (c && c.kind !== 'block') target = solve(slotMatrix(c, Math.min(previewSlot, c.rows * c.cols - 1)));
    } else if (selection?.type === 'safe') {
      const s = project.safePoints.find((x) => x.id === selection.id);
      if (s) target = safePointJoints(s, project);
    } else if (selection?.type === 'waypoint') {
      const w = project.waypoints.find((x) => x.name === selection.id);
      if (w) target = w.q ?? solve(waypointMatrix(w, project));
    }
    a.target = target ?? homeQ;
  }, [selection, project, previewSlot, homeQ, params, arm]);

  useEffect(() => setPreviewSlot(0), [selection?.id]);

  const add = useCallback((key: string, at?: [number, number]) => {
    const reach = ROBOTS[project.robot.model].reach;
    const [x, y] = at ?? [0.05 * (project.components.length % 5), reach * 0.55];
    if (key === 'safe_point') {
      const s = makeSafePoint(project, x, y);
      update((p) => ({ ...p, safePoints: [...p.safePoints, s] }));
      select({ type: 'safe', id: s.id });
    } else {
      const entry = CATALOG.find((e) => e.key === key);
      if (!entry) return;
      const c = makeComponent(entry, project, x, y);
      update((p) => ({ ...p, components: [...p.components, c] }));
      select({ type: 'component', id: c.id });
    }
    setTab('inspect');
  }, [project, update, select]);

  const importFile = useCallback(async (file: File) => {
    const text = await file.text();
    if (file.name.endsWith('.json')) {
      try {
        replace(normalizeProject(JSON.parse(text)));
        setNotice(`Opened ${file.name}`);
      } catch {
        setNotice(`${file.name} is not a deck file`);
      }
      return;
    }
    const { waypoints, script } = parseScript(text);
    if (!waypoints.length) {
      setNotice(`No waypoints in ${file.name} (looking for name = p[...] and name = [...])`);
      return;
    }
    update((p): Project => ({ ...p, waypoints, script: { fileName: file.name, ...script } }));
    select(null);
    setNotice(`${waypoints.length} waypoint${waypoints.length > 1 ? 's' : ''} from ${file.name}: click one to build a station, tray or safe point on it`);
  }, [replace, update, select]);

  // keyboard: undo/redo, delete, gizmo mode, escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.key === 'Escape') select(null);
      if (e.key === 'g' || e.key === 'w') setMode('translate');
      if (e.key === 'r' || e.key === 'e') setMode('rotate');
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        if (selection.type === 'component') update((p) => ({ ...p, components: p.components.filter((c) => c.id !== selection.id) }));
        if (selection.type === 'waypoint') update((p) => ({ ...p, waypoints: p.waypoints.filter((w) => w.name !== selection.id) }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, select, selection, update]);

  // files dropped anywhere: a .script or a deck .json
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) void importFile(f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [importFile]);

  const openFile = (accept: string) => {
    if (!fileInput.current) return;
    fileInput.current.accept = accept;
    fileInput.current.click();
  };

  const onViewportDrop = (e: React.DragEvent) => {
    const key = e.dataTransfer.getData(DRAG_TYPE);
    setDropping(false);
    if (!key) return;
    e.preventDefault();
    e.stopPropagation();
    const at = projector.current?.(e.clientX, e.clientY);
    add(key, at ? [Math.round(at[0] * 200) / 200, Math.round(at[1] * 200) / 200] : undefined);
  };

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'inspect', label: selection ? 'Inspect' : 'Deck' },
    { id: 'checks', label: 'Checks', badge: problems },
    { id: 'motion', label: 'Motion' },
    { id: 'python', label: 'Python' },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Bot size={20} /><span>Arm Location <em>Helper</em></span></div>
        <span className="deck-name" title="The deck (edit it with nothing selected)">{project.name} · {ROBOTS[project.robot.model].label}</span>
        <div className="toolbar">
          <button className="icon-btn" title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}><Undo2 size={16} /></button>
          <button className="icon-btn" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}><Redo2 size={16} /></button>
          <span className="sep" />
          <button className="btn ghost" onClick={() => { if (confirm('Start an empty deck? (Undo brings this one back.)')) replace(emptyProject()); }}><FilePlus2 size={15} /> New</button>
          <button className="btn ghost" onClick={() => replace(demoProject())}><Sparkles size={15} /> Demo</button>
          <button className="btn ghost" onClick={() => openFile('.script,.urscript,.txt')} title="Waypoints from a URScript file, as Polyscope saves it"><Upload size={15} /> Import .script</button>
          <button className="btn ghost" onClick={() => openFile('.json')} title="A deck saved with Save"><FolderOpen size={15} /> Open</button>
          <button className="btn ghost" onClick={() => download(projectFileName(project), JSON.stringify(project, null, 2), 'application/json')}><Save size={15} /> Save</button>
          <span className="sep" />
          <button className="icon-btn" title={dark ? 'Light theme' : 'Dark theme'} onClick={() => setDark(!dark)}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
        </div>
        <input ref={fileInput} type="file" accept=".script,.urscript,.txt,.json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
      </header>

      <div className="workspace">
        <Library onAdd={(k) => add(k)} findings={findings} />

        <main className={`viewport ${dropping ? 'dropping' : ''}`}
          onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setDropping(true); } }}
          onDragLeave={() => setDropping(false)}
          onDrop={onViewportDrop}>
          <Scene project={project} home={homeQ} mode={mode} snap={snap} showLabels={showLabels} showPath={showPath} dark={dark}
            itemsVersion={itemsVersion} projector={projector} onItemsChanged={onItemsChanged} />
          <div className="overlay top-left">
            <div className="seg">
              <button className={mode === 'translate' ? 'on' : ''} onClick={() => setMode('translate')} title="Move (G)"><Move3d size={15} /> Move</button>
              <button className={mode === 'rotate' ? 'on' : ''} onClick={() => setMode('rotate')} title="Turn about Z (R)"><RotateCw size={15} /> Turn</button>
            </div>
            <Toggle label="Snap 5 mm / 5°" checked={snap} onChange={setSnap} />
            <Toggle label="Labels" checked={showLabels} onChange={setShowLabels} />
            {project.waypoints.length > 0 && <Toggle label="Script path" checked={showPath} onChange={setShowPath} />}
          </div>
          <div className="overlay bottom-left muted small">
            Base frame: <span className="x">X</span> <span className="y">Y</span> <span className="z">Z</span> · drag to orbit, right-drag to pan
          </div>
          {notice && <div className="toast">{notice}</div>}
        </main>

        <aside className="column right">
          <nav className="tabs">
            {tabs.map((t) => (
              <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}{t.badge ? <span className="badge error">{t.badge}</span> : null}
              </button>
            ))}
          </nav>
          <div className="tab-body">
            {tab === 'inspect' && <Inspector previewSlot={previewSlot} setPreviewSlot={setPreviewSlot} />}
            {tab === 'checks' && <ChecksPanel findings={findings} />}
            {tab === 'motion' && <MotionPanel key={project.robot.model} onItemsChanged={onItemsChanged} />}
            {tab === 'python' && <CodePanel findings={findings} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Editor />
    </StoreProvider>
  );
}
