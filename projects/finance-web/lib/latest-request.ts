export type RequestTicket = {
  signal: AbortSignal;
  isCurrent: () => boolean;
};

// Cancellation saves work; the generation check also protects against responses
// from transports that finish after cancellation.
export class LatestRequest {
  private generation = 0;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  cancel() {
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }

  private begin(): RequestTicket {
    this.cancel();
    const generation = this.generation;
    this.controller = new AbortController();
    return { signal: this.controller.signal, isCurrent: () => generation === this.generation };
  }

  run<T>(task: (ticket: RequestTicket) => Promise<T>): Promise<T> {
    return task(this.begin());
  }

  schedule(task: (ticket: RequestTicket) => void, delayMs: number) {
    const ticket = this.begin();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (ticket.isCurrent()) task(ticket);
    }, delayMs);
  }
}
