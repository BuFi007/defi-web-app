import { describe, expect, test } from "bun:test";

import {
  DEFAULT_RETRY_DELAYS_MS,
  decideNextAttempt,
  initialAttempt,
  MAX_DELIVERY_ATTEMPTS,
} from "../src/retry";

describe("retry decideNextAttempt", () => {
  test("default schedule matches the Wave H2 spec (1m, 5m, 30m, 6h, 24h)", () => {
    expect(DEFAULT_RETRY_DELAYS_MS).toEqual([
      60_000,
      300_000,
      1_800_000,
      21_600_000,
      86_400_000,
    ]);
    expect(MAX_DELIVERY_ATTEMPTS).toBe(5);
  });

  test("first failure schedules attempt 2 after 5 minutes", () => {
    const decision = decideNextAttempt({ attempt: 1, nowMs: 0 });
    expect(decision.kind).toBe("retry");
    expect(decision.nextAttempt).toBe(2);
    expect(decision.scheduledFor).toBe(DEFAULT_RETRY_DELAYS_MS[1]);
  });

  test("fifth failure dead-letters", () => {
    const decision = decideNextAttempt({ attempt: 5, nowMs: 1_000 });
    expect(decision.kind).toBe("dead_letter");
    expect(decision.scheduledFor).toBe(1_000);
  });

  test("initialAttempt fires immediately on attempt 1", () => {
    const decision = initialAttempt(42);
    expect(decision.kind).toBe("retry");
    expect(decision.nextAttempt).toBe(1);
    expect(decision.scheduledFor).toBe(42);
  });

  test("walking the full schedule", () => {
    // After attempt N fails, next attempt is N+1 with wait = delays[N].
    const delays = DEFAULT_RETRY_DELAYS_MS;
    for (let i = 1; i < delays.length; i++) {
      const decision = decideNextAttempt({ attempt: i, nowMs: 0 });
      expect(decision.kind).toBe("retry");
      expect(decision.nextAttempt).toBe(i + 1);
      expect(decision.scheduledFor).toBe(delays[i]);
    }
  });

  test("custom delays array overrides the default", () => {
    const decision = decideNextAttempt({
      attempt: 1,
      nowMs: 100,
      delays: [10, 20, 30],
    });
    expect(decision.scheduledFor).toBe(120);

    const dead = decideNextAttempt({
      attempt: 3,
      nowMs: 1_000,
      delays: [10, 20, 30],
    });
    expect(dead.kind).toBe("dead_letter");
  });
});
