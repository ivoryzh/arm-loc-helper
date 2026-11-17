// What sits in a component's slots, for drawing: a vial, an SBS plate, or a placeholder for whatever
// a side rack holds.
import type { DeckComponent } from './deck';

export type ItemKind = 'vial' | 'plate' | 'placeholder';

export function itemKind(c: DeckComponent): ItemKind | null {
  if (c.kind === 'block') return null;
  if (c.kind === 'side_rack') return 'placeholder'; // a rack takes slides, plates, tubes: no one shape
  return c.gripHeight < 0.015 ? 'plate' : 'vial';
}

export function vialRadius(c: DeckComponent): number {
  const pitch = c.kind === 'tray' ? Math.min(c.colPitch, c.cols > 1 ? c.colPitch : 1, c.rows > 1 ? c.rowPitch : 1) : 1;
  return Math.max(0.004, Math.min(0.011, pitch * 0.36));
}

/** How wide an item is where the fingers close on it. */
export function itemWidth(c: DeckComponent): number | null {
  const kind = itemKind(c);
  if (kind === 'vial') return 2 * vialRadius(c);
  if (kind === 'plate') return 0.0855; // an SBS plate, held across its short side
  if (kind === 'placeholder') return 2 * placeholderRadius(c);
  return null;
}

/** The dot that stands for an item in a side rack: sized to its slots, never more than a marble. */
export function placeholderRadius(c: DeckComponent): number {
  const pitch = Math.min(c.cols > 1 ? c.colPitch : 1, c.rows > 1 ? c.rowPitch : 1);
  return Math.max(0.004, Math.min(0.009, pitch * 0.3));
}

/**
 * A plate's turn about the tool's z, in the TCP's frame. It lies square in its nest, long side along
 * the nest's x, so it is turned back by however far the gripper is turned to grip it.
 */
export function plateTurn(c: DeckComponent): number {
  return (c.toolYaw * Math.PI) / 180;
}
