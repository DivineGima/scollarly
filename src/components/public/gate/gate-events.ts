/** The event that asks the sign-in pop-up to open, for code that is not a button (a lead refused because the session ended). */
export const GATE_EVENT = "scollarly:gate";

export interface GateRequest {
  /** The public page to return to after signing in. Checked again by `safeNext` on the server. */
  next: string;
}

export function requestGate(next: string): void {
  window.dispatchEvent(new CustomEvent<GateRequest>(GATE_EVENT, { detail: { next } }));
}
