// Right column, first tab: the selected component, safe point or waypoint, or the deck itself.
import { Copy, Crosshair, House, Link2, Trash2, Wand2 } from 'lucide-react';
import { componentReach } from '../../lib/checks';
import {
  SKILL_LABEL, allIds, className, linksOf, nearestSafePoint, skillOf, slotCount, slug, tiltFromSkill, uniqueId,
  type DeckComponent, type GripperType, type Project, type SafePointDef,
} from '../../lib/deck';
import { ROBOTS, ROBOT_IDS, type RobotModelId } from '../../lib/robots';
import { anchorTo, componentFromWaypoint, safePointFromWaypoint, waypointMatrix } from '../../lib/teach';
import { useStore } from '../../state';
import { NumberField, Row, Section, SelectField, TextField, Toggle } from './fields';

const MM = { scale: 1000, unit: 'mm', digits: 1 };
const DEG = { unit: '°', digits: 2 };
const RAD_AS_DEG = { scale: 180 / Math.PI, unit: '°', digits: 2 };

export function Inspector({ previewSlot, setPreviewSlot }: { previewSlot: number; setPreviewSlot: (n: number) => void }) {
  const { project, selection } = useStore();
  if (selection?.type === 'component') {
    const c = project.components.find((x) => x.id === selection.id);
    if (c) return <ComponentInspector c={c} previewSlot={previewSlot} setPreviewSlot={setPreviewSlot} />;
  }
  if (selection?.type === 'safe') {
    const s = project.safePoints.find((x) => x.id === selection.id);
    if (s) return <SafePointInspector s={s} />;
  }
  if (selection?.type === 'waypoint') {
    const w = project.waypoints.find((x) => x.name === selection.id);
    if (w) return <WaypointInspector name={w.name} />;
  }
  return <DeckSettings />;
}

/** Rename an id, keeping it a unique Python name and every reference to it. */
function renameId(p: Project, kind: 'component' | 'safe', from: string, wanted: string): Project {
  const id = uniqueId(slug(wanted), allIds(p).filter((x) => x !== from));
  if (id === from) return p;
  if (kind === 'component') return { ...p, components: p.components.map((c) => (c.id === from ? { ...c, id } : c)) };
  return {
    ...p,
    home: p.home === from ? id : p.home,
    safePoints: p.safePoints.map((s) => ({ ...s, id: s.id === from ? id : s.id, links: s.links.map((l) => (l === from ? id : l)) })),
    components: p.components.map((c) => (c.safePoint === from ? { ...c, safePoint: id } : c)),
  };
}

function ComponentInspector({ c, previewSlot, setPreviewSlot }: { c: DeckComponent; previewSlot: number; setPreviewSlot: (n: number) => void }) {
  const { project, update, select } = useStore();
  const set = (change: Partial<DeckComponent>, key?: string) =>
    update((p) => ({ ...p, components: p.components.map((x) => (x.id === c.id ? { ...x, ...change } : x)) }), key ? `${c.id}.${key}` : undefined);
  const skill = skillOf(c);
  const n = slotCount(c);
  const reach = skill ? componentReach(project, c) : null;
  const reachable = reach ? reach.slots.filter((r, i) => r !== 'none' && reach.approaches[i] !== 'none').length : 0;
  const tilt = tiltFromSkill(c);
  const poseWaypoints = project.waypoints;

  return (
    <div className="inspector">
      <Section title={c.label} aside={<span className="chip">{c.kind.replace('_', ' ')}</span>}>
        <TextField label="Name" value={c.label} onChange={(v) => set({ label: v }, 'label')} />
        <TextField label="Python name" mono value={c.id} onCommit={(v) => {
          update((p) => renameId(p, 'component', c.id, v));
          select({ type: 'component', id: uniqueId(slug(v), allIds(project).filter((x) => x !== c.id)) });
        }} />
        {skill && <p className="muted small">{SKILL_LABEL[skill]}.</p>}
      </Section>

      <Section title={c.kind === 'block' ? 'Footprint centre' : 'Slot 0 grip point'}>
        <Row>
          <NumberField label="X" value={c.x} onChange={(v) => set({ x: v }, 'x')} {...MM} />
          <NumberField label="Y" value={c.y} onChange={(v) => set({ y: v }, 'y')} {...MM} />
          {c.kind !== 'block' && <NumberField label="Z" value={c.z} onChange={(v) => set({ z: v }, 'z')} {...MM} />}
        </Row>
        <Row>
          <NumberField label="Turn" value={c.yaw} onChange={(v) => set({ yaw: v }, 'yaw')} {...DEG} title="The component's rotation about the base z axis" />
          {skill && <NumberField label={skill === 'side_load' ? 'Tool roll' : 'Tool yaw'} value={c.toolYaw} onChange={(v) => set({ toolYaw: v }, 'toolYaw')} {...DEG}
            title="The gripper's turn about its own axis, relative to the component" />}
        </Row>
      </Section>

      {(c.kind === 'tray' || c.kind === 'side_rack') && (
        <Section title="Slots">
          <Row>
            <NumberField label={c.kind === 'tray' ? 'Rows' : 'Levels'} value={c.rows} integer min={1} max={64} onChange={(v) => set({ rows: v }, 'rows')} />
            <NumberField label={c.kind === 'tray' ? 'Columns' : 'Across'} value={c.cols} integer min={1} max={64} onChange={(v) => set({ cols: v }, 'cols')} />
          </Row>
          <Row>
            <NumberField label={c.kind === 'tray' ? 'Column pitch' : 'Across pitch'} value={c.colPitch} onChange={(v) => set({ colPitch: v }, 'colPitch')} {...MM} />
            <NumberField label={c.kind === 'tray' ? 'Row pitch' : 'Level pitch'} value={c.rowPitch} onChange={(v) => set({ rowPitch: v }, 'rowPitch')} {...MM} />
          </Row>
          <p className="muted small">{c.kind === 'tray' ? 'Slot index goes row by row: slot = row × columns + column.' : 'Slot 0 is the bottom level; slot = level × across + position.'}</p>
        </Section>
      )}

      {skill && (
        <Section title="Approach">
          <Row>
            <NumberField label={skill === 'top_down' ? 'Above the slot' : 'Out along the axis'} value={c.approach} min={0} onChange={(v) => set({ approach: v }, 'approach')} {...MM} />
            {c.kind !== 'side_rack' && <NumberField label="Grip depth" value={c.gripHeight} min={0} onChange={(v) => set({ gripHeight: v }, 'gripHeight')} {...MM}
              title="How far below the grip point the item stands on the body (draws the body)" />}
          </Row>
          <SelectField label="Entered from" value={c.safePoint} onChange={(v) => set({ safePoint: v })}
            options={project.safePoints.map((s) => ({ value: s.id, label: s.label + (s.id === project.home ? ' (home)' : '') }))} />
        </Section>
      )}

      {skill && (
        <Section title="Orientation">
          {c.taught ? (
            <>
              <p className="small">Taught{c.taughtFrom ? <> from <code>{c.taughtFrom}</code></> : ''}: {tilt.toFixed(2)}° from the {skill === 'top_down' ? 'vertical' : 'rack axis'}.</p>
              <button className="btn" onClick={() => set({ taught: undefined, taughtFrom: undefined })}><Wand2 size={14} /> Snap to the {skill === 'top_down' ? 'vertical' : 'rack axis'}</button>
            </>
          ) : (
            <p className="muted small">{skill === 'top_down' ? 'Tool straight down, turned with the component.' : 'Tool horizontal, along the insertion axis (the component\'s +X).'}</p>
          )}
          {poseWaypoints.length > 0 && (
            <SelectField label="Put slot 0 on a waypoint" value={'' as string} onChange={(name) => {
              const w = project.waypoints.find((x) => x.name === name);
              if (w) update((p) => ({ ...p, components: p.components.map((x) => (x.id === c.id ? anchorTo(x, w, p) : x)) }));
            }} options={[{ value: '', label: 'choose a waypoint…' }, ...poseWaypoints.map((w) => ({ value: w.name, label: w.name }))]} />
          )}
        </Section>
      )}

      <Section title="Body">
        <Row>
          <NumberField label={c.kind === 'side_rack' ? 'Depth' : 'Width (X)'} value={c.size[0]} min={0.005} onChange={(v) => set({ size: [v, c.size[1], c.size[2]] }, 'size0')} {...MM} />
          <NumberField label={c.kind === 'side_rack' ? 'Width' : 'Depth (Y)'} value={c.size[1]} min={0.005} onChange={(v) => set({ size: [c.size[0], v, c.size[2]] }, 'size1')} {...MM} />
          {c.kind === 'block' && <NumberField label="Height" value={c.size[2]} min={0.005} onChange={(v) => set({ size: [c.size[0], c.size[1], v] }, 'size2')} {...MM} />}
        </Row>
        <Row>
          <label className="field"><span className="field-label">Colour</span><input type="color" value={c.color} onChange={(e) => set({ color: e.target.value }, 'color')} /></label>
          {skill && <Toggle label="Slots start full" checked={c.filled} onChange={(v) => set({ filled: v })} hint="For the motion preview: whether there is something to pick up" />}
        </Row>
      </Section>

      {skill && (
        <Section title="Reach" aside={<span className={`chip ${reachable === n ? 'ok' : 'bad'}`}>{reachable}/{n}</span>}>
          {n > 1 && <NumberField label="Show the arm at slot" value={Math.min(previewSlot, n - 1)} integer min={0} max={n - 1} onChange={setPreviewSlot} />}
          <p className="muted small">Teal: reachable. Amber: only with the elbow down. Red: out of reach.</p>
        </Section>
      )}

      <div className="actions">
        <button className="btn" onClick={() => {
          const id = uniqueId(c.id, allIds(project));
          update((p) => ({ ...p, components: [...p.components, { ...c, id, label: `${c.label} copy`, x: c.x + 0.05, y: c.y + 0.05, taught: undefined, taughtFrom: undefined }] }));
          select({ type: 'component', id });
        }}><Copy size={14} /> Duplicate</button>
        <button className="btn danger" onClick={() => update((p) => ({ ...p, components: p.components.filter((x) => x.id !== c.id) }))}><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  );
}

function SafePointInspector({ s }: { s: SafePointDef }) {
  const { project, update, select } = useStore();
  const set = (change: Partial<SafePointDef>, key?: string) =>
    update((p) => ({ ...p, safePoints: p.safePoints.map((x) => (x.id === s.id ? { ...x, ...change } : x)) }), key ? `${s.id}.${key}` : undefined);
  const links = linksOf(project).get(s.id) ?? new Set<string>();
  const users = project.components.filter((c) => c.safePoint === s.id);
  const others = project.safePoints.filter((x) => x.id !== s.id);

  const toggleLink = (other: string, on: boolean) => update((p) => ({
    ...p,
    safePoints: p.safePoints.map((x) => {
      if (x.id === s.id) return { ...x, links: on ? [...new Set([...x.links, other])] : x.links.filter((l) => l !== other) };
      if (x.id === other && !on) return { ...x, links: x.links.filter((l) => l !== s.id) };
      return x;
    }),
  }));

  return (
    <div className="inspector">
      <Section title={s.label} aside={<span className="chip">{s.id === project.home ? 'home' : 'safe point'}</span>}>
        <TextField label="Name" value={s.label} onChange={(v) => set({ label: v }, 'label')} />
        <TextField label="Python name" mono value={s.id} onCommit={(v) => {
          update((p) => renameId(p, 'safe', s.id, v));
          select({ type: 'safe', id: uniqueId(slug(v), allIds(project).filter((x) => x !== s.id)) });
        }} />
        <p className="muted small">Free space the arm can always go to. Moves between safe points are joint moves, so keep every link's straight line clear of the deck.</p>
      </Section>
      <Section title="Where">
        {s.q ? (
          <>
            <p className="small">Taught joints{s.taughtFrom ? <> from <code>{s.taughtFrom}</code></> : ''}, used exactly as recorded:</p>
            <p className="mono small">[{s.q.map((v) => ((v * 180) / Math.PI).toFixed(1)).join('°, ')}°]</p>
            <button className="btn" onClick={() => set({ q: undefined, taughtFrom: undefined })}>Use the position instead</button>
          </>
        ) : (
          <>
            <Row>
              <NumberField label="X" value={s.x} onChange={(v) => set({ x: v }, 'x')} {...MM} />
              <NumberField label="Y" value={s.y} onChange={(v) => set({ y: v }, 'y')} {...MM} />
              <NumberField label="Z" value={s.z} onChange={(v) => set({ z: v }, 'z')} {...MM} />
            </Row>
            <NumberField label="Tool heading" value={s.heading} onChange={(v) => set({ heading: v }, 'heading')} {...DEG} title="The tool points down with its x axis this way" />
          </>
        )}
      </Section>
      <Section title="Links" aside={<Link2 size={14} />}>
        {others.length ? others.map((o) => (
          <Toggle key={o.id} label={o.label} checked={links.has(o.id)} onChange={(on) => toggleLink(o.id, on)} />
        )) : <p className="muted small">Add another safe point to link it.</p>}
      </Section>
      <Section title="Entered from here">
        {users.length ? <p className="small">{users.map((c) => c.label).join(', ')}</p> : <p className="muted small">No component uses it yet.</p>}
      </Section>
      <div className="actions">
        {s.id !== project.home && <button className="btn" onClick={() => update((p) => ({ ...p, home: s.id }))}><House size={14} /> Make home</button>}
        <button className="btn danger" disabled={project.safePoints.length < 2} onClick={() => update((p) => {
          const rest = p.safePoints.filter((x) => x.id !== s.id).map((x) => ({ ...x, links: x.links.filter((l) => l !== s.id) }));
          const fallback = (c: DeckComponent) => nearestSafePoint({ ...p, safePoints: rest }, c.x, c.y, c.z) ?? rest[0].id;
          return { ...p, safePoints: rest, home: p.home === s.id ? rest[0].id : p.home,
            components: p.components.map((c) => (c.safePoint === s.id ? { ...c, safePoint: fallback(c) } : c)) };
        })}><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  );
}

function WaypointInspector({ name }: { name: string }) {
  const { project, update, select } = useStore();
  const w = project.waypoints.find((x) => x.name === name)!;
  const m = waypointMatrix(w, project);
  const addComponent = (key: string) => {
    const c = componentFromWaypoint(key, w, project);
    update((p) => ({ ...p, components: [...p.components, c] }));
    select({ type: 'component', id: c.id });
  };
  return (
    <div className="inspector">
      <Section title={w.name} aside={<span className="chip">waypoint</span>}>
        {w.pose && <p className="mono small">p[{w.pose.map((v, i) => (i < 3 ? (v * 1000).toFixed(1) : v.toFixed(4))).join(', ')}]<br /><span className="muted">mm, rad</span></p>}
        {w.q && <p className="mono small">q[{w.q.map((v) => ((v * 180) / Math.PI).toFixed(1)).join(', ')}]<br /><span className="muted">degrees</span></p>}
        {!w.pose && <p className="muted small">Joints only: the TCP is at ({(m[3] * 1000).toFixed(0)}, {(m[7] * 1000).toFixed(0)}, {(m[11] * 1000).toFixed(0)}) mm with this deck's TCP.</p>}
      </Section>
      <Section title="Use it" aside={<Crosshair size={14} />}>
        <p className="muted small">A component made here has its slot 0 on this point and keeps the taught orientation (the Checks tab says how far it is from the skill's).</p>
        <div className="stack">
          <button className="btn" onClick={() => addComponent('vial_tray')}>Vial tray, slot 0 here</button>
          <button className="btn" onClick={() => addComponent('station')}>Station here</button>
          <button className="btn" onClick={() => addComponent('side_rack')}>Side-load rack, slot 0 here</button>
          <button className="btn" onClick={() => {
            const s = safePointFromWaypoint(w, project);
            update((p) => ({ ...p, safePoints: [...p.safePoints, s] }));
            select({ type: 'safe', id: s.id });
          }}>Safe point here{w.q ? ' (with its joints)' : ''}</button>
        </div>
      </Section>
    </div>
  );
}

function DeckSettings() {
  const { project: p, update } = useStore();
  const set = (fn: (p: Project) => Project, key?: string) => update(fn, key);
  const tcp = p.robot.tcp;
  const setTcp = (i: number, v: number) => set((q) => ({ ...q, robot: { ...q.robot, tcp: q.robot.tcp.map((x, j) => (j === i ? v : x)) } }), `tcp${i}`);
  const motion = (k: keyof Project['motion'], v: number) => set((q) => ({ ...q, motion: { ...q.motion, [k]: v } }), `motion.${k}`);
  const g = p.gripper;
  const grip = (change: Partial<Project['gripper']>) => set((q) => ({ ...q, gripper: { ...q.gripper, ...change } }), 'gripper');
  const autoClass = className(p.name);

  return (
    <div className="inspector">
      <Section title="Deck">
        <TextField label="Name" value={p.name} onChange={(v) => set((q) => ({ ...q, name: v, className: q.className === className(q.name) ? className(v) : q.className }), 'name')} />
        <TextField label="Python class" mono value={p.className} onCommit={(v) => set((q) => ({ ...q, className: /^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? v : autoClass }))} />
        <NumberField label="Bench height" value={p.benchZ} onChange={(v) => set((q) => ({ ...q, benchZ: v }), 'benchZ')} {...MM} title="Where the bench is in the robot's base frame (negative if the robot stands on a plate)" />
        <p className="muted small">Click anything on the deck to edit it. Nothing selected shows these settings.</p>
      </Section>
      <Section title="Arm">
        <SelectField<RobotModelId> label="Model" value={p.robot.model} onChange={(v) => set((q) => ({ ...q, robot: { ...q.robot, model: v } }))}
          options={ROBOT_IDS.map((id) => ({ value: id, label: `${ROBOTS[id].label} · ${ROBOTS[id].reach * 1000} mm reach` }))} />
        <p className="muted small">TCP: the gripper's fingertips from the flange, as on the pendant (Installation › TCP).</p>
        <Row>
          <NumberField label="TCP X" value={tcp[0]} onChange={(v) => setTcp(0, v)} {...MM} />
          <NumberField label="TCP Y" value={tcp[1]} onChange={(v) => setTcp(1, v)} {...MM} />
          <NumberField label="TCP Z" value={tcp[2]} onChange={(v) => setTcp(2, v)} {...MM} />
        </Row>
        <Row>
          <NumberField label="RX" value={tcp[3]} onChange={(v) => setTcp(3, v)} {...RAD_AS_DEG} />
          <NumberField label="RY" value={tcp[4]} onChange={(v) => setTcp(4, v)} {...RAD_AS_DEG} />
          <NumberField label="RZ" value={tcp[5]} onChange={(v) => setTcp(5, v)} {...RAD_AS_DEG} />
        </Row>
        <NumberField label="Payload" value={p.robot.payload} min={0} onChange={(v) => set((q) => ({ ...q, robot: { ...q.robot, payload: v } }), 'payload')} unit="kg" digits={2} />
      </Section>
      <Section title="Gripper">
        <SelectField<GripperType> label="Type" value={g.type} onChange={(v) => grip({ type: v })} options={[
          { value: 'robotiq', label: 'Robotiq 2F / Hand-E (URCap socket)' },
          { value: 'digital_out', label: 'Digital output (pneumatic, tool I/O)' },
          { value: 'none', label: 'None / my own gripper class' },
        ]} />
        {g.type === 'robotiq' && (
          <Row>
            <NumberField label="Speed" value={g.speed} integer min={0} max={255} onChange={(v) => grip({ speed: v })} />
            <NumberField label="Force" value={g.force} integer min={0} max={255} onChange={(v) => grip({ force: v })} />
          </Row>
        )}
        {g.type === 'digital_out' && (
          <Row>
            <NumberField label="Output" value={g.pin} integer min={0} max={7} onChange={(v) => grip({ pin: v })} />
            <Toggle label="Tool output" checked={g.tool} onChange={(v) => grip({ tool: v })} />
            <Toggle label="On = closed" checked={g.closeLevel} onChange={(v) => grip({ closeLevel: v })} />
          </Row>
        )}
        {g.type === 'none' && <p className="muted small">Pass your own: <code>{p.className}(host=…, gripper=MyGripper())</code> with open() and close().</p>}
      </Section>
      <Section title="Speeds">
        <Row>
          <NumberField label="Joint speed" value={p.motion.joint_speed} min={0.01} onChange={(v) => motion('joint_speed', v)} {...RAD_AS_DEG} unit="°/s" digits={0} />
          <NumberField label="Joint accel" value={p.motion.joint_accel} min={0.01} onChange={(v) => motion('joint_accel', v)} {...RAD_AS_DEG} unit="°/s²" digits={0} />
        </Row>
        <Row>
          <NumberField label="Linear speed" value={p.motion.linear_speed} min={0.001} onChange={(v) => motion('linear_speed', v)} {...MM} unit="mm/s" digits={0} />
          <NumberField label="Linear accel" value={p.motion.linear_accel} min={0.001} onChange={(v) => motion('linear_accel', v)} {...MM} unit="mm/s²" digits={0} />
        </Row>
        <NumberField label="Into a slot" value={p.motion.approach_speed} min={0.001} onChange={(v) => motion('approach_speed', v)} {...MM} unit="mm/s" digits={0}
          title="The last straight line in and out of every slot" />
        <p className="muted small">These are the maximum speeds; <code>speed=0.5</code> in Python halves all of them.</p>
      </Section>
    </div>
  );
}
