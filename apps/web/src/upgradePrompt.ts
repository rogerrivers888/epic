/**
 * "Adding people needs the Household plan" (owner, 2 Oct 2026). The server
 * refuses any add past a Solo plan's one person with `details.upgrade`, from
 * whichever door it came through — Settings, voice, joining a group — and the
 * request helper raises this once, so every door shows the same prompt
 * without each screen catching it. A module emitter, like the toast, so
 * api.ts never imports a component.
 */
type Listener = (message: string, householdCap: number) => void;
const listeners = new Set<Listener>();

export function raiseUpgradePrompt(message: string, householdCap = 6) {
  listeners.forEach((fn) => fn(message, householdCap));
}

export function onUpgradePrompt(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
