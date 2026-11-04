// The exported controller: one Python file with the runtime (arm_loc_helper/runtime.py, as it is),
// the deck as data, and a class whose methods name the deck's own locations, typed so IvoryOS shows
// them as dropdowns. Nothing in it needs more than the standard library, plus ur_rtde for a robot.
import { linksOf, slotCount, type DeckComponent, type Project } from './deck';
import { exportDeck, type RuntimeDeck } from './runtimeDeck';
import { ROBOTS } from './robots';

/** A Python literal for JSON-like data, numbers inline in short lists. */
export function pyLiteral(v: unknown, indent = 0): string {
  const pad = ' '.repeat(indent), inner = ' '.repeat(indent + 4);
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'None';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null)) return `[${v.map((x) => pyLiteral(x)).join(', ')}]`;
    return `[\n${v.map((x) => inner + pyLiteral(x, indent + 4)).join(',\n')},\n${pad}]`;
  }
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pyLiteral(x, indent + 4)}`).join(',\n')},\n${pad}}`;
}

/** The runtime without its module docstring (the exported file has its own). */
export function runtimeBody(source: string): string {
  return source.replace(/^\s*"""[\s\S]*?"""\s*\n/, '').trim();
}

const placeVerb = (c: DeckComponent) => (c.kind === 'station' ? 'place_on' : 'place_in');

function describe(c: DeckComponent, deck: RuntimeDeck): string {
  const n = slotCount(c);
  const shape = c.kind === 'station' ? '1 slot' : c.kind === 'side_rack'
    ? `${c.rows} level${c.rows > 1 ? 's' : ''} x ${c.cols}, slot 0 at the bottom`
    : `${c.rows} x ${c.cols}, ${n} slots row by row`;
  const skill = deck.locations[c.id].skill === 'side_load' ? 'side-load' : 'top-down';
  return `${c.label}: ${shape}, ${skill}, entered from ${c.safePoint}`;
}

function slotDoc(c: DeckComponent): string {
  const n = slotCount(c);
  if (c.kind === 'side_rack') return `slot 0-${n - 1}: ${c.cols > 1 ? `${c.cols} across each level, ` : ''}levels from the bottom up`;
  return `slot 0-${n - 1}, row by row (${c.cols} per row)`;
}

// names and labels go into docstrings and comments: no backslashes, quotes or line breaks there
const docSafe = (s: string) => s.replace(/[\\\r\n]+/g, ' ').replace(/"/g, "'");

export function generatePython(project: Project, runtimeSource: string, moduleName = 'deck_arm'): string {
  const p: Project = {
    ...project,
    name: docSafe(project.name),
    components: project.components.map((c) => ({ ...c, label: docSafe(c.label) })),
    safePoints: project.safePoints.map((s) => ({ ...s, label: docSafe(s.label) })),
  };
  const deck = exportDeck(p);
  const model = ROBOTS[p.robot.model];
  const cls = p.className;
  const locs = p.components.filter((c) => deck.locations[c.id]);
  const width = Math.max(8, ...locs.map((c) => c.id.length));
  const links = linksOf(p);
  const pairs = [...links].flatMap(([a, bs]) => [...bs].filter((b) => a < b).map((b) => `${a}-${b}`));
  const source = locs.find((c) => c.filled) ?? locs[0];
  const target = locs.find((c) => c !== source && !c.filled) ?? locs.find((c) => c !== source);

  const lines: string[] = [];
  const example = source && target
    ? `arm.transfer(${JSON.stringify(source.id)}, ${JSON.stringify(target.id)})`
    : source ? `arm.pick(${JSON.stringify(source.id)}, 0)` : 'arm.home()';
  lines.push(`"""${p.name}: pick-and-place for a ${model.label}, exported by Arm Location Helper.

    from ${moduleName} import ${cls}
    arm = ${cls}()                       # simulation: prints every move, no robot needed
    arm = ${cls}(host="192.168.1.10")    # the arm itself, through ur_rtde (pip install ur_rtde)
    ${example}

Locations (slot 0 first):
${locs.length ? locs.map((c) => `    ${c.id.padEnd(width)}  ${describe(c, deck)}`).join('\n') : '    (none yet)'}

Safe points: ${p.safePoints.map((s) => (s.id === p.home ? `${s.id} (home)` : s.id)).join(', ')}
Linked: ${pairs.length ? pairs.join(', ') : 'none'}

Every move goes safe point -> approach point -> slot, and back out the same way. Change the deck in
Arm Location Helper and export it again rather than editing DECK by hand: the editor checks reach,
tilt and the safe paths before it writes this file.
"""`);
  lines.push('');
  lines.push('# ---------------------------------------------------------------------------------------------');
  lines.push('# The runtime: arm_loc_helper/runtime.py, unchanged. The deck and its class are at the end.');
  lines.push('# ---------------------------------------------------------------------------------------------');
  lines.push(runtimeBody(runtimeSource));
  lines.push('');
  lines.push('');
  lines.push('# ---------------------------------------------------------------------------------------------');
  lines.push(`# The deck: ${p.name}`);
  lines.push('# ---------------------------------------------------------------------------------------------');
  lines.push('from typing import Literal  # noqa: E402');
  lines.push('');
  lines.push(`DECK = ${pyLiteral(deck)}`);
  lines.push('');
  const lit = (xs: string[]) => (xs.length ? `Literal[${xs.map((x) => JSON.stringify(x)).join(', ')}]` : 'str');
  lines.push(`LocationName = ${lit(locs.map((c) => c.id))}`);
  lines.push(`SafePointName = ${lit(p.safePoints.map((s) => s.id))}`);
  lines.push('');
  lines.push('');
  lines.push(`class ${cls}(ArmController):`);
  lines.push(`    """${p.name} on a ${model.label}: pick, place and move between its locations along the safe paths."""`);
  lines.push('');
  lines.push('    def __init__(self, host: Optional[str] = None, speed: float = 1.0):');
  lines.push('        """host: the robot\'s IP address, or None to simulate. speed: a fraction of the deck\'s speeds."""');
  lines.push('        super().__init__(DECK, host=host, speed=speed)');
  const wrap = (sig: string, doc: string, call: string) => {
    lines.push('');
    lines.push(`    def ${sig} -> None:`);
    lines.push(`        """${doc}"""`);
    lines.push(`        ${call}`);
  };
  if (locs.length) {
    wrap('pick(self, location: LocationName, index: int = 0)', 'Pick up the item in a slot: in through the approach point, grip, back out.', 'super().pick(location, index)');
    wrap('place(self, location: LocationName, index: int = 0)', 'Put the held item into a slot: in through the approach point, release, back out.', 'super().place(location, index)');
    wrap('transfer(self, source: LocationName, destination: LocationName, source_index: int = 0, destination_index: int = 0)',
      'Pick from one slot and place into another.', 'super().transfer(source, destination, source_index, destination_index)');
    wrap('move_above(self, location: LocationName, index: int = 0)', 'Go to the approach point of a slot.', 'super().move_above(location, index)');
    wrap('move_to(self, location: LocationName, index: int = 0)', 'Go into a slot without using the gripper.', 'super().move_to(location, index)');
  }
  wrap('go_to_safe_point(self, name: SafePointName)', 'Go to a safe point along the safe network.', 'super().go_to_safe_point(name)');

  for (const c of locs) {
    const single = slotCount(c) === 1;
    const args = single ? '' : ', index: int = 0';
    const idx = single ? '0' : 'index';
    lines.push('');
    lines.push(`    # ${c.label}`);
    wrap(`pick_from_${c.id}(self${args})`, `Pick up from ${c.label}${single ? '' : ` (${slotDoc(c)})`}.`, `self.pick(${JSON.stringify(c.id)}, ${idx})`);
    wrap(`${placeVerb(c)}_${c.id}(self${args})`, `Place into ${c.label}${single ? '' : ` (${slotDoc(c)})`}.`, `self.place(${JSON.stringify(c.id)}, ${idx})`);
  }

  lines.push('');
  lines.push('');
  lines.push('if __name__ == "__main__":');
  lines.push(`    # a dry run, no robot: python ${moduleName}.py`);
  lines.push(`    arm = ${cls}()`);
  lines.push(`    ${example}`);
  lines.push('    arm.home()');
  lines.push('');
  return lines.join('\n');
}

/** The file name for a deck's controller: snake case of the class name (MyDeckArm -> my_deck_arm). */
export function moduleNameOf(p: Project): string {
  return p.className.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
