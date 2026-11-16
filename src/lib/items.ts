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
