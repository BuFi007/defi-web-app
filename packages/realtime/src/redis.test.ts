import { afterEach, describe, expect, test } from "bun:test";

import {
  PERPS_INTENT_INSERTED_CHANNEL,
  publishChannel,
  resetRedisClients,
  subscribeChannel,
  type PerpsIntentInsertedMessage,
} from "./index";

// The publish/subscribe surface backs both the Wave E6 WS fan-out AND the
// Wave H1 matcher intent-notify. In CI we don't boot a real Redis; these
// tests exercise the in-process EventEmitter fallback which is what apps
// see when REDIS_URL is unset. The Redis-backed path is exercised manually
// (see docs/runbook/MATCHER_REDIS_NOTIFY.md).

afterEach(async () => {
  await resetRedisClients();
});

describe("@bufi/realtime publish/subscribe (no REDIS_URL)", () => {
  test("emitter fallback delivers JSON payloads round-trip", async () => {
    const received: unknown[] = [];
    const unsubscribe = subscribeChannel(
      "trades:EUR-USD-PERP",
      (payload) => {
        received.push(payload);
      },
      { url: null },
    );

    await publishChannel(
      "trades:EUR-USD-PERP",
      { type: "realtime", channel: "trades:EUR-USD-PERP", data: { priceE18: "1" } },
      { url: null },
    );

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      type: "realtime",
      channel: "trades:EUR-USD-PERP",
      data: { priceE18: "1" },
    });

    unsubscribe();
  });

  test("unsubscribe stops further deliveries", async () => {
    const received: unknown[] = [];
    const unsubscribe = subscribeChannel(
      "book:EUR-USD-PERP",
      (payload) => {
        received.push(payload);
      },
      { url: null },
    );

    await publishChannel("book:EUR-USD-PERP", { sequence: 1 }, { url: null });
    expect(received).toHaveLength(1);

    unsubscribe();
    await publishChannel("book:EUR-USD-PERP", { sequence: 2 }, { url: null });
    expect(received).toHaveLength(1);
  });

  test("multiple subscribers on same channel each receive the payload", async () => {
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    const unsubA = subscribeChannel(
      "funding:EUR-USD-PERP",
      (p) => receivedA.push(p),
      { url: null },
    );
    const unsubB = subscribeChannel(
      "funding:EUR-USD-PERP",
      (p) => receivedB.push(p),
      { url: null },
    );

    await publishChannel(
      "funding:EUR-USD-PERP",
      { rateE18: "1" },
      { url: null },
    );

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);

    unsubA();
    unsubB();
  });

  test("PERPS_INTENT_INSERTED_CHANNEL fans out the typed payload", async () => {
    const received: PerpsIntentInsertedMessage[] = [];
    const unsubscribe = subscribeChannel(
      PERPS_INTENT_INSERTED_CHANNEL,
      (payload) => {
        received.push(payload as PerpsIntentInsertedMessage);
      },
      { url: null },
    );

    const msg: PerpsIntentInsertedMessage = {
      intentId: "0xdeadbeef",
      marketId: "0xfeed",
      chainId: 5042002,
      side: "long",
      insertedAt: 1_700_000_000_000,
    };
    await publishChannel(PERPS_INTENT_INSERTED_CHANNEL, msg, { url: null });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(msg);

    unsubscribe();
  });
});
