import sessions from 'telegram/sessions/index.js';
import authKeys from 'telegram/crypto/AuthKey.js';
import { Buffer } from 'node:buffer';

// StringSession alone discards every non-main DC auth key. Keep the media keys
// independently so an object restart does not recreate all download sessions.
export class DurableSession extends sessions.StringSession {
  constructor(value) { super(value); this.mediaKeys = new Map(); }
  getAuthKey(dc) { return !dc || dc === this.dcId ? super.getAuthKey(dc) : this.mediaKeys.get(dc); }
  setAuthKey(key, dc) {
    if (!dc || dc === this.dcId) super.setAuthKey(key, dc);
    else if (key) this.mediaKeys.set(dc, key); else this.mediaKeys.delete(dc);
    this.onChange?.();
  }
  async restore(keys = {}) {
    for (const [dc, encoded] of Object.entries(keys)) { const key = new authKeys.AuthKey(); await key.setKey(Buffer.from(encoded, 'base64')); this.setAuthKey(key, Number(dc)); }
  }
  snapshot() { return { main: this.save(), keys: Object.fromEntries([...this.mediaKeys].filter(([, key]) => key?.getKey()).map(([dc, key]) => [dc, key.getKey().toString('base64')])) }; }
}
