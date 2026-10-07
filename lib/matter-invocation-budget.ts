import { AsyncLocalStorage } from "node:async_hooks";

// Below Fluid Compute's 300s default; ingress explicitly caps execution at 180s.
// A full Task 13 page needs at most 1 list + 100 item + 100 annotation attempts.
export const MATTER_INVOCATION_LIMITS = Object.freeze({
  pages: 8, requests: 224, upstreamMs: 90_000, totalMs: 150_000, requestMs: 10_000,
});
export type MatterInvocationLimits = { [K in keyof typeof MATTER_INVOCATION_LIMITS]: number };
export class MatterBudgetStop extends Error {
  constructor(readonly reason: "requests" | "deadline" | "timeout" | "pages") {
    super(`Matter invocation stopped at its ${reason} budget.`);
  }
}
export class MatterInvocationBudget {
  requests = 0;
  pages = 0;
  private readonly started: number;
  constructor(readonly limits: MatterInvocationLimits = MATTER_INVOCATION_LIMITS, private readonly clock = () => performance.now()) {
    for (const [key, value] of Object.entries(limits)) {
      if (!Number.isSafeInteger(value) || value < 1 || value > MATTER_INVOCATION_LIMITS[key as keyof MatterInvocationLimits]) {
        throw new Error("Invalid Matter invocation budget");
      }
    }
    if (limits.totalMs < limits.upstreamMs || limits.requestMs > limits.upstreamMs) throw new Error("Invalid Matter deadline");
    this.started = clock();
  }
  check() {
    if (this.clock() - this.started >= this.limits.upstreamMs) throw new MatterBudgetStop("deadline");
  }
  remainingTotalMs = () => Math.max(1, this.limits.totalMs - (this.clock() - this.started));
  canRecover = () => this.clock() - this.started < this.limits.totalMs - 10_000;
  admitPage(limit: number) {
    this.check();
    if (this.pages >= this.limits.pages) throw new MatterBudgetStop("pages");
    // First page receives a fresh invocation. Later pages reserve the maximum
    // preparation cost, preventing repeated failure on a residual request budget.
    if (this.pages > 0 && this.limits.requests - this.requests < limit + 101) throw new MatterBudgetStop("requests");
  }
  async attempt<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.check();
    if (this.requests >= this.limits.requests) throw new MatterBudgetStop("requests");
    this.requests++;
    const controller = new AbortController();
    const remaining = this.limits.upstreamMs - (this.clock() - this.started);
    const reason = remaining <= this.limits.requestMs ? "deadline" : "timeout";
    const timer = setTimeout(() => controller.abort(new MatterBudgetStop(reason)), Math.min(remaining, this.limits.requestMs));
    let onAbort: () => void = () => {};
    try {
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      const value = await Promise.race([work(controller.signal), aborted]);
      this.check();
      return value;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
    }
  }
}
const context = new AsyncLocalStorage<MatterInvocationBudget>();
export const getMatterInvocationBudget = () => context.getStore();
export const withMatterInvocationBudget = <T>(budget: MatterInvocationBudget, work: () => Promise<T>) => context.run(budget, work);
