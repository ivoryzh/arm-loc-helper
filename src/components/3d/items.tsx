// The things the arm carries: a vial, an SBS plate, a slide. Drawn in the TCP's frame (z out of the
// gripper), so the same mesh sits in a slot and hangs from the fingers.
import type { DeckComponent } from '../../lib/deck';
import { itemKind, vialRadius } from '../../lib/items';

/** An item with the TCP at the origin and the tool's z axis pointing into it. */
export function Item({ c, ghost = false }: { c: DeckComponent; ghost?: boolean }) {
  const kind = itemKind(c);
  const opacity = ghost ? 0.25 : 1;
  if (kind === 'vial') {
    const r = vialRadius(c), above = 0.012, below = Math.max(0.01, c.gripHeight);
    const h = above + below;
    return (
      <group>
        <mesh position={[0, 0, (below - above) / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[r, r, h, 20]} />
          <meshStandardMaterial color="#bae6fd" transparent opacity={0.55 * opacity} roughness={0.1} />
        </mesh>
        <mesh position={[0, 0, -above + 0.004]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[r * 1.05, r * 1.05, 0.009, 20]} />
          <meshStandardMaterial color="#1f2937" transparent opacity={opacity} />
        </mesh>
      </group>
    );
  }
  if (kind === 'plate') {
    return (
      <mesh position={[0, 0, 0.004]}>
        <boxGeometry args={[0.1278, 0.0855, 0.0144]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.85 * opacity} />
      </mesh>
    );
  }
  if (kind === 'slide') {
    // a slide held at its near end, its length along the insertion axis (tool z)
    return (
      <mesh position={[0, 0, 0.026]}>
        <boxGeometry args={[0.003, 0.026, 0.075]} />
        <meshStandardMaterial color="#cffafe" transparent opacity={0.8 * opacity} />
      </mesh>
    );
  }
  return null;
}
