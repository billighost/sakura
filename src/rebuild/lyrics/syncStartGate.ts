import { HostedSyncError } from "./hostedSync";

interface StartState { acceptedAt?: number; owner?: object }

/** Reserve before catalogue/provider work. Failed starts release their lease;
 * confirmed accepted jobs retain the existing one-minute account cooldown. */
export class SyncStartGate {
  private readonly states = new Map<string, StartState>();
  constructor(private readonly now = Date.now, private readonly capacity = 256, private readonly cooldownMs = 60_000) {}

  reserve(accountId: string) {
    const now = this.now();
    for (const [key, state] of this.states) {
      if (!state.owner && (state.acceptedAt === undefined || now - state.acceptedAt >= this.cooldownMs)) this.states.delete(key);
    }
    let state = this.states.get(accountId);
    if (state?.owner) throw new HostedSyncError("An auto-sync job is already starting. Please wait before trying again.", 429, 1000);
    const remaining = state?.acceptedAt === undefined ? 0 : this.cooldownMs - (now - state.acceptedAt);
    if (remaining > 0) throw new HostedSyncError("Please wait a minute before starting another auto-sync job.", 429, remaining);
    if (!state && this.states.size >= this.capacity) throw new HostedSyncError("The auto-sync queue is busy. Please try again shortly.", 429, 1000);
    state ||= {};
    const owned = state, owner = {};
    owned.owner = owner;
    this.states.set(accountId, owned);
    let released = false;
    return {
      accepted: () => { if (!released && owned.owner === owner) owned.acceptedAt = this.now(); },
      release: () => {
        if (released) return;
        released = true;
        if (owned.owner !== owner) return;
        delete owned.owner;
        if (owned.acceptedAt === undefined && this.states.get(accountId) === owned) this.states.delete(accountId);
      },
    };
  }
}
