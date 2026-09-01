/**
 * In-memory FIFO stage queue with both a global concurrency cap and an
 * optional per-group cap. Waiting jobs do not consume slots in any other
 * stage queue, which lets plugin tasks pipeline LLM expansion and image
 * generation independently.
 */
export class StageQueue<T> {
  private readonly pending: T[] = [];
  private readonly activeByGroup = new Map<string, number>();
  private active = 0;

  constructor(
    private readonly options: {
      readonly name: string;
      readonly maxConcurrent: number;
      readonly getGroup: (item: T) => string;
      readonly getGroupLimit: (item: T) => number;
      readonly run: (item: T) => Promise<void>;
      readonly onError: (error: unknown, item: T) => void;
    },
  ) {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
      throw new Error(`${options.name} maxConcurrent must be a positive integer`);
    }
  }

  enqueue(item: T): void {
    this.pending.push(item);
    this.drain();
  }

  snapshot(): { active: number; queued: number } {
    return { active: this.active, queued: this.pending.length };
  }

  private drain(): void {
    while (this.active < this.options.maxConcurrent) {
      const index = this.pending.findIndex(item => {
        const group = this.options.getGroup(item);
        const groupLimit = this.options.getGroupLimit(item);
        return (this.activeByGroup.get(group) ?? 0) < groupLimit;
      });
      if (index < 0) return;

      const [item] = this.pending.splice(index, 1);
      if (item === undefined) return;
      const group = this.options.getGroup(item);
      this.active += 1;
      this.activeByGroup.set(group, (this.activeByGroup.get(group) ?? 0) + 1);

      void this.options.run(item).catch(error => {
        this.options.onError(error, item);
      }).finally(() => {
        this.active -= 1;
        const remaining = (this.activeByGroup.get(group) ?? 1) - 1;
        if (remaining === 0) this.activeByGroup.delete(group);
        else this.activeByGroup.set(group, remaining);
        this.drain();
      });
    }
  }
}
