import { ILogger } from "@/core/logger/logger.interface";

export interface KeyedAsyncQueueOptions {
  /** Optional logger instance for queue events and error reporting */
  logger?: ILogger;
}

/**
 * KeyedAsyncQueue provides partitioned asynchronous serialization:
 *
 * 1. FIFO Per-Key Sequencing: Tasks with the SAME key (e.g. Telegram chatId)
 *    execute strictly sequentially in the exact order they were enqueued.
 * 2. Cross-Key Concurrency: Tasks with DIFFERENT keys execute concurrently
 *    in parallel without blocking or waiting for each other.
 * 3. Error Isolation: Any unexpected failure in one task is caught and reported,
 *    and never prevents subsequent tasks for that key from executing.
 * 4. Memory Hygiene: Once all tasks for a key finish and the queue is idle,
 *    the key is automatically purged from memory.
 */
export class KeyedAsyncQueue<K = string | number> {
  private readonly queues = new Map<K, Promise<void>>();
  private readonly pendingCounts = new Map<K, number>();
  private readonly logger?: ILogger;

  constructor(options?: KeyedAsyncQueueOptions) {
    this.logger = options?.logger;
  }

  /**
   * Enqueues an asynchronous task for the specified partition key.
   * Execution for this key will wait until any previously enqueued tasks for this key settle.
   * Tasks for other keys begin executing immediately in parallel.
   *
   * @param key Partition identifier (e.g. numeric Telegram chatId)
   * @param task Asynchronous task function to execute
   */
  public enqueue(key: K, task: () => Promise<void>): Promise<void> {
    const currentPending = (this.pendingCounts.get(key) || 0) + 1;
    this.pendingCounts.set(key, currentPending);

    const previousPromise = this.queues.get(key) || Promise.resolve();

    // Chain onto the previous task for this key
    const currentPromise = previousPromise
      .catch(() => {
        // Prevent prior task rejection from stopping the queue chain
      })
      .then(async () => {
        try {
          await task();
        } catch (err: unknown) {
          if (this.logger) {
            this.logger.error(`[KeyedAsyncQueue] Error executing task for key [${String(key)}]:`, err);
          }
        }
      })
      .finally(() => {
        const remaining = (this.pendingCounts.get(key) || 1) - 1;
        if (remaining <= 0) {
          this.pendingCounts.delete(key);
        } else {
          this.pendingCounts.set(key, remaining);
        }

        // Clean up the queue entry if no subsequent task was appended behind this one
        if (this.queues.get(key) === currentPromise) {
          this.queues.delete(key);
        }
      });

    this.queues.set(key, currentPromise);
    return currentPromise;
  }

  /**
   * Returns the number of distinct keys currently active or queued.
   */
  public getActiveKeyCount(): number {
    return this.queues.size;
  }

  /**
   * Returns the number of tasks currently executing or pending for a specific key.
   */
  public getPendingCount(key: K): number {
    return this.pendingCounts.get(key) || 0;
  }

  /**
   * Returns the total number of tasks currently executing or pending across all keys.
   */
  public getTotalPendingCount(): number {
    let total = 0;
    for (const count of this.pendingCounts.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Waits for all currently queued tasks across all keys to settle,
   * up to an optional timeout in milliseconds.
   */
  public async waitForIdle(timeoutMs: number = 10_000): Promise<void> {
    if (this.queues.size === 0) return;

    const allPromises = Array.from(this.queues.values());
    const settlePromise = Promise.allSettled(allPromises).then(() => {});

    if (timeoutMs <= 0) {
      await settlePromise;
      return;
    }

    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });

    try {
      await Promise.race([settlePromise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
