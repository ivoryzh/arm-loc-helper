// The things the arm carries: a vial, an SBS plate, a placeholder for anything else. Drawn in the
// TCP's frame (z out of the gripper), so the same mesh sits in a slot and hangs from the fingers.
import type { DeckComponent } from '../../lib/deck';
import { itemKind, placeholderRadius, plateTurn, vialRadius } from '../../lib/items';

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
    // square in its nest, not turned with the gripper
    return (
      <mesh position={[0, 0, 0.004]} rotation={[0, 0, plateTurn(c)]}>
        <boxGeometry args={[0.1278, 0.0855, 0.0144]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.85 * opacity} />
      </mesh>
    );
  }
  if (kind === 'placeholder') {
    // a dot at the grip point: the rack does not say what it holds
    return (
      <mesh>
        <sphereGeometry args={[placeholderRadius(c), 16, 12]} />
        <meshStandardMaterial color="#f8fafc" transparent opacity={0.9 * opacity} roughness={0.4} />
      </mesh>
    );
  }
  return null;
}
