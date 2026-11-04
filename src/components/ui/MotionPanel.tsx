// Right column, Motion tab: play what a call does, move by move, exactly as the exported controller
// plans it (same planner), with the arm moving as a UR does.
import { useMemo, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { slotCount } from '../../lib/deck';
import type { Joints } from '../../lib/kinematics';
import { buildTrajectory, type Trajectory } from '../../lib/motion';
import { PlanError, plan, stateName, type Action, type ArmState, type PlanStep } from '../../lib/planner';
import { exportDeck, safePointJoints } from '../../lib/runtimeDeck';
import { useStore } from '../../state';
import { NumberField, Row, SelectField } from './fields';

const ACTIONS: { value: Action; label: string }[] = [
  { value: 'transfer', label: 'transfer: pick, then place' },
  { value: 'pick', label: 'pick' },
  { value: 'place', label: 'place' },
  { value: 'move_above', label: 'move_above' },
  { value: 'move_to', label: 'move_to' },
  { value: 'safe_point', label: 'go_to_safe_point' },
  { value: 'home', label: 'home' },
];

const KIND_LABEL: Record<PlanStep['kind'], string> = { movej: 'movej', movej_pose: 'movej (IK)', movel: 'movel', gripper: 'gripper' };

export function MotionPanel({ onItemsChanged }: { onItemsChanged: () => void }) {
  const { project, arm } = useStore();
  const deck = useMemo(() => exportDeck(project), [project]);
  const locations = project.components.filter((c) => slotCount(c) > 0);
  const [action, setAction] = useState<Action>('transfer');
  const [source, setSource] = useState(locations.find((c) => c.filled)?.id ?? locations[0]?.id ?? '');
  const [sourceIndex, setSourceIndex] = useState(0);
  const [dest, setDest] = useState(locations.find((c) => !c.filled)?.id ?? locations[1]?.id ?? '');
  const [destIndex, setDestIndex] = useState(0);
  const [safe, setSafe] = useState(project.home);
  const [speed, setSpeed] = useState('2');
  const [current, setCurrent] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [from, setFrom] = useState<{ state: ArmState; q: Joints; grip: number } | null>(null);

  const src = locations.find((c) => c.id === source) ?? locations[0];
  const dst = locations.find((c) => c.id === dest) ?? locations[0];
  const startState: ArmState = from?.state ?? { kind: 'safe', name: project.home };
  const homePoint = project.safePoints.find((s) => s.id === project.home);
  const homeQ = homePoint ? safePointJoints(homePoint, project) : null;

  let steps: PlanStep[] = [];
  let planError: string | null = null;
  try {
    if (action === 'home') steps = plan(deck, 'home', startState);
    else if (action === 'safe_point') steps = plan(deck, 'safe_point', startState, safe);
    else if (!src) planError = 'Add a component with slots first.';
    else if (action === 'transfer') {
      if (!dst) planError = 'Transfer needs a destination.';
      else steps = plan(deck, 'transfer', startState, src.id, Math.min(sourceIndex, slotCount(src) - 1), dst.id, Math.min(destIndex, slotCount(dst) - 1));
    } else steps = plan(deck, action, startState, src.id, Math.min(sourceIndex, slotCount(src) - 1));
  } catch (e) {
    planError = e instanceof PlanError ? e.message : String(e);
  }

  const startQ = from?.q ?? homeQ;
  const traj: Trajectory | null = useMemo(() => (startQ && steps.length ? buildTrajectory(project, steps, startQ, from?.grip ?? 1) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, JSON.stringify(steps), startQ]);

  const call = action === 'home' ? 'arm.home()'
    : action === 'safe_point' ? `arm.go_to_safe_point("${safe}")`
      : action === 'transfer' ? `arm.transfer("${src?.id}", "${dst?.id}", ${sourceIndex}, ${destIndex})`
        : `arm.${action}("${src?.id}", ${sourceIndex})`;

  const stop = () => {
    const run = arm.current.player;
    if (run) run.running = false;
    arm.current.playing = false;
    setPlaying(false);
  };

  const playIt = () => {
    if (!traj) return;
    if (from === null) {
      // a fresh start: items back where the deck starts them
      arm.current.occupancy.clear();
      arm.current.carrying = null;
      onItemsChanged();
    }
    arm.current.grip = from?.grip ?? 1;
    setCurrent(0);
    setPlaying(true);
    // with an error the trajectory stops before the failing step: it plays up to there
    arm.current.player = {
      traj, t: 0, segStart: 0, seg: 0, speed: Number(speed), running: true,
      onSegment: (i) => setCurrent(i),
      onEnd: () => {
        setPlaying(false);
        setCurrent(-1);
        if (!traj.error && steps.length) {
          setFrom({ state: steps[steps.length - 1].after, q: traj.end, grip: traj.segments.length ? traj.segments[traj.segments.length - 1].gripTo : 1 });
        }
      },
    };
  };

  const reset = () => {
    stop();
    setFrom(null);
    arm.current.player = null;
    arm.current.target = null;
    arm.current.carrying = null;
    arm.current.grip = 1;
    arm.current.occupancy.clear();
    onItemsChanged();
  };

  const indexField = (label: string, value: number, set: (n: number) => void, n: number) =>
    n > 1 ? <NumberField label={label} value={Math.min(value, n - 1)} integer min={0} max={n - 1} onChange={set} /> : null;

  return (
    <div className="motion">
      <SelectField<Action> label="Call" value={action} onChange={setAction} options={ACTIONS} />
      {action === 'safe_point' && (
        <SelectField label="Safe point" value={safe} onChange={setSafe} options={project.safePoints.map((s) => ({ value: s.id, label: s.label }))} />
      )}
      {action !== 'home' && action !== 'safe_point' && src && (
        <Row>
          <SelectField label={action === 'transfer' ? 'From' : 'Location'} value={src.id} onChange={setSource} options={locations.map((c) => ({ value: c.id, label: c.label }))} />
          {indexField('Slot', sourceIndex, setSourceIndex, slotCount(src))}
        </Row>
      )}
      {action === 'transfer' && dst && (
        <Row>
          <SelectField label="To" value={dst.id} onChange={setDest} options={locations.map((c) => ({ value: c.id, label: c.label }))} />
          {indexField('Slot', destIndex, setDestIndex, slotCount(dst))}
        </Row>
      )}
      <div className="player-bar">
        {playing
          ? <button className="btn primary" onClick={stop}><Pause size={14} /> Stop</button>
          : <button className="btn primary" disabled={!traj} onClick={playIt}><Play size={14} /> Play</button>}
        <button className="btn" onClick={reset} title="Back to home, items back in place"><RotateCcw size={14} /> Reset</button>
        <SelectField label="Speed" wide={false} value={speed} onChange={setSpeed} options={['1', '2', '4', '8'].map((v) => ({ value: v, label: `${v}×` }))} />
        <span className="muted small duration">{traj ? `${traj.total.toFixed(1)} s on the robot` : ''}</span>
      </div>
      <p className="muted small">Starts {from ? <>where the last preview ended, <code>{stateName(from.state)}</code></> : <>at home, <code>{project.home}</code></>}.</p>

      <div className="steps">
        <div className="step call"><code>{call}</code></div>
        {planError && <div className="step error">{planError}</div>}
        {steps.map((s, i) => {
          const bad = traj?.error?.step === i;
          return (
            <div key={i} className={`step ${i === current ? 'current' : ''} ${bad ? 'error' : ''} ${traj?.error && i > traj.error.step ? 'dim' : ''}`}>
              <span className="step-kind">{KIND_LABEL[s.kind]}{s.slow ? ' · slow' : ''}</span>
              <span className="step-name mono">{s.kind === 'gripper' ? `${s.name}()` : s.name}</span>
              {bad && <span className="step-error">{traj!.error!.message}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
