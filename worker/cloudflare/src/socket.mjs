import { Buffer } from 'node:buffer';

// Inject the runtime TCP function and the durable ownership fence. GramJS also
// uses this adapter for its separate media DC connections.
export function socketClass(open, fence, sockets = new Set(), metrics) {
  return class WorkersSocket {
    constructor() { this.closed = true; this.pending = Buffer.alloc(0); this.writes = Promise.resolve(); }
    async connect(port, hostname) {
      if (this.opening) return this.opening;
      this.opening = (async () => {
        await fence();
        this.closed = false;
        sockets.add(this);
        this.connection = open({ hostname, port });
        this.connection.closed.catch(() => {});
        await this.connection.opened;
        this.reader = this.connection.readable.getReader();
        this.writer = this.connection.writable.getWriter();
      })();
      try { await this.opening; }
      catch (error) { await this.close(); throw error; }
    }
    async read(n) {
      if (this.closed) throw new Error('Telegram socket closed');
      while (!this.pending.length) {
        const part = await this.reader.read();
        if (part.done) { await this.close(); throw new Error('Telegram socket ended'); }
        this.pending = Buffer.from(part.value);
      }
      const part = this.pending.subarray(0, n);
      this.pending = this.pending.subarray(part.length);
      return part;
    }
    async readExactly(n) {
      if (!Number.isSafeInteger(n) || n < 0 || n > 2 * 1024 * 1024) throw new Error('Invalid Telegram packet length');
      const parts = []; let count = 0;
      while (count < n) { const next = await this.read(n - count); parts.push(next); count += next.length; }
      return Buffer.concat(parts, count);
    }
    write(bytes) {
      // GramJS's Connection._send does not await socket.write. Keep ordering,
      // handle rejection here, and terminate the receive loop on stale owners.
      const work = this.writes.then(async () => {
        if (this.closed) throw new Error('Telegram socket closed');
        await fence();
        if (this.closed) throw new Error('Telegram socket closed');
        metrics?.count('packet_bytes', bytes.byteLength);
        const send = () => this.writer.write(bytes);
        await (metrics ? metrics.measure('socket_write', send) : send());
      });
      this.writes = work.catch(async () => { await this.close(); });
      return work;
    }
    async close() {
      this.closed = true;
      sockets.delete(this);
      await Promise.allSettled([this.reader?.cancel(), this.writer?.abort(), this.connection?.close()]);
    }
  };
}
