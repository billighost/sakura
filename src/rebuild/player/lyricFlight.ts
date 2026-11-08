interface Flight<T> { controller: AbortController; promise: Promise<T>; users: number }

/** Mini/fullscreen players share a request; closing one does not cancel the other. */
export class LyricFlights<T> {
  private flights = new Map<string, Flight<T>>();
  acquire(key: string, load: (signal: AbortSignal) => Promise<T>) {
    let flight = this.flights.get(key);
    if (!flight || flight.controller.signal.aborted) {
      const controller = new AbortController();
      const next: Flight<T> = { controller, users: 0, promise: Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return load(controller.signal);
      }).finally(() => { if (this.flights.get(key) === next) this.flights.delete(key); }) };
      this.flights.set(key, next);
      flight = next;
    }
    flight.users++;
    const owned = flight;
    let released = false;
    return { promise: owned.promise, release: () => {
      if (released) return;
      released = true;
      owned.users--;
      if (!owned.users && this.flights.get(key) === owned) {
        this.flights.delete(key);
        owned.controller.abort();
      }
    } };
  }
}
