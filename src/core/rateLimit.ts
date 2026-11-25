import type { Client } from "discord.js-selfbot-v13";

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  label?: string;
  debug?: boolean;
}

export interface RateLimitEventInfo {
  phase: string;
  timeoutMs: number;
  path: string;
  global: boolean;
}

export type RateLimitDecision = "skip" | "wait";
export type RateLimitHandler = (info: RateLimitEventInfo) => Promise<RateLimitDecision>;

/**
 * Listens to Discord.js REST rateLimit events in real time so long cooldowns
 * (such as the 1-hour 50-emoji bucket) are detected immediately instead of silently hanging.
 */
export class RateLimitMonitor {
  private lastEvent: { timeoutMs: number; path: string; global: boolean; at: number } | null = null;
  private listener: ((data: any) => void) | null = null;
  private waiters: Array<(evt: { timeoutMs: number; path: string; global: boolean }) => void> = [];

  constructor(private readonly client: Client) {
    this.listener = (data: any) => {
      const timeoutMs =
        typeof data?.timeout === "number"
          ? data.timeout
          : typeof data?.timeToReset === "number"
          ? data.timeToReset
          : 0;
      const evt = {
        timeoutMs,
        path: String(data?.path ?? data?.route ?? "discord-api"),
        global: Boolean(data?.global),
        at: Date.now(),
      };
      this.lastEvent = evt;
      if (timeoutMs >= 10000) {
        const pending = this.waiters.splice(0, this.waiters.length);
        for (const resolve of pending) {
          resolve(evt);
        }
      }
    };
    this.client.on("rateLimit" as any, this.listener);
  }

  public dispose(): void {
    if (this.listener) {
      this.client.removeListener("rateLimit" as any, this.listener);
      this.listener = null;
    }
    this.waiters = [];
  }

  public getRecentLongLimit(maxAgeMs = 15000): { timeoutMs: number; path: string; global: boolean } | null {
    if (!this.lastEvent) return null;
    if (Date.now() - this.lastEvent.at <= maxAgeMs && this.lastEvent.timeoutMs >= 10000) {
      return this.lastEvent;
    }
    return null;
  }

  /**
   * Races a Discord API call against either:
   *  - A real-time `rateLimit` event >= 10s, OR
   *  - A stall timeout (default 14s) indicating Discord's REST queue is holding the request.
   */
  public async runWithGuard<T>(
    operation: () => Promise<T>,
    stallThresholdMs = 14000
  ): Promise<
    | { status: "ok"; value: T }
    | { status: "rate_limited"; timeoutMs: number; path: string; global: boolean; pendingPromise: Promise<T> }
  > {
    const opPromise = operation();
    // Prevent unhandled rejection if caller decides to skip while opPromise eventually settles
    opPromise.catch(() => {});

    let timer: NodeJS.Timeout | null = null;
    let settled = false;

    const guardPromise = new Promise<{
      status: "rate_limited";
      timeoutMs: number;
      path: string;
      global: boolean;
      pendingPromise: Promise<T>;
    }>((resolve) => {
      const onLongLimit = (evt: { timeoutMs: number; path: string; global: boolean }) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({
          status: "rate_limited",
          timeoutMs: evt.timeoutMs,
          path: evt.path,
          global: evt.global,
          pendingPromise: opPromise,
        });
      };

      this.waiters.push(onLongLimit);

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const recent = this.getRecentLongLimit(30000);
        resolve({
          status: "rate_limited",
          timeoutMs: recent?.timeoutMs ?? 60 * 60 * 1000,
          path: recent?.path ?? "discord-rest-queue",
          global: Boolean(recent?.global),
          pendingPromise: opPromise,
        });
      }, stallThresholdMs);
    });

    const wrappedOp = opPromise.then((value) => {
      settled = true;
      if (timer) clearTimeout(timer);
      return { status: "ok" as const, value };
    });

    return Promise.race([wrappedOp, guardPromise]);
  }
}

export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { retries = 3, baseDelayMs = 1000, label = "operation", debug = false } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      const code = error?.code ?? error?.httpStatus;
      if (code === 50013 || code === 50001 || code === 10004 || code === 403 || code === 404) {
        throw error;
      }

      if (attempt < retries) {
        const retryAfterSec =
          typeof error?.retry_after === "number"
            ? error.retry_after
            : typeof error?.timeout === "number"
            ? error.timeout / 1000
            : null;

        const waitMs = retryAfterSec
          ? Math.ceil(retryAfterSec * 1000) + 250
          : baseDelayMs * Math.pow(2, attempt - 1);

        if (debug) {
          console.warn(
            `\n[Debug] ${label} failed (attempt ${attempt}/${retries}). Retrying in ${waitMs}ms...`,
            error?.message ?? error
          );
        }
        await sleep(waitMs);
      }
    }
  }

  throw lastError;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const hh = hours.toString().padStart(2, "0");
  const mm = minutes.toString().padStart(2, "0");
  const ss = secs.toString().padStart(2, "0");

  return hours > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}
