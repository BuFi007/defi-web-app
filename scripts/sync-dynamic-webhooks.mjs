#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const loadEnvLocal = () => {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = valueParts.join("=");
    }
  }
};

loadEnvLocal();

const apiBase =
  process.env.DYNAMIC_API_BASE ?? "https://app.dynamic.xyz/api/v0";
const apiToken = process.env.DYNAMIC_API_TOKEN;
const environmentId =
  process.env.DYNAMIC_ENVIRONMENT_ID ??
  process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID;

const productionUrl =
  process.env.DYNAMIC_WEBHOOK_PRODUCTION_URL ??
  "https://fx.bu.finance/api/dynamic-webhook";
const previewUrl =
  process.env.DYNAMIC_WEBHOOK_PREVIEW_URL ??
  "https://defi-web-app-preview-bu-finance-007.vercel.app/api/dynamic-webhook";
const localUrl =
  process.env.DYNAMIC_WEBHOOK_LOCAL_URL ??
  "https://sendero-dev-BUFI.ngrok.app/api/dynamic-webhook";
const defaultEvents = (process.env.DYNAMIC_WEBHOOK_EVENTS ?? "user.created")
  .split(",")
  .map((event) => event.trim())
  .filter(Boolean);

const legacyProductionUrls = [
  "https://boofi.xyz/api/dynamic-webhook",
  "https://defi.boofi.xyz/api/dynamic-webhook",
];
const legacyLocalUrls = [
  "https://picked-tidy-gnat.ngrok-free.app/api/dynamic-webhook",
  "https://monkey-notable-rarely.ngrok-free.app/api/dynamic-webhook",
];

if (!apiToken) {
  throw new Error("DYNAMIC_API_TOKEN is required to sync Dynamic webhooks.");
}

if (!environmentId) {
  throw new Error(
    "NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID or DYNAMIC_ENVIRONMENT_ID is required.",
  );
}

if (defaultEvents.length === 0) {
  throw new Error("DYNAMIC_WEBHOOK_EVENTS must include at least one event.");
}

const dynamicFetch = async (path, init = {}) => {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `${init.method ?? "GET"} ${path} failed: ${response.status} ${body}`,
    );
  }

  return response.json();
};

const listWebhooks = async () => {
  const response = await dynamicFetch(
    `/environments/${environmentId}/webhooks`,
  );
  return Array.isArray(response.data) ? response.data : [];
};

const webhookBody = ({ events, isEnabled = true, url }) =>
  JSON.stringify({ events, isEnabled, url });

const updateWebhook = async (webhook, url, events, isEnabled = true) =>
  dynamicFetch(`/environments/${environmentId}/webhooks/${webhook.webhookId}`, {
    method: "PUT",
    body: webhookBody({ events, isEnabled, url }),
  });

const createWebhook = async (url, events) =>
  dynamicFetch(`/environments/${environmentId}/webhooks`, {
    method: "POST",
    body: webhookBody({ events, url }),
  });

const getEvents = (webhook) =>
  Array.isArray(webhook?.events) && webhook.events.length > 0
    ? webhook.events
    : defaultEvents;

const findByUrl = (webhooks, urls) =>
  webhooks.find((webhook) => urls.includes(webhook.url));

const syncTarget = async ({ label, targetUrl, legacyUrls, webhooks }) => {
  const current = findByUrl(webhooks, [targetUrl]);
  if (current) {
    const events = getEvents(current);
    await updateWebhook(current, targetUrl, events, true);
    console.log(`enabled ${label}: ${targetUrl}`);
    return { events, webhookId: current.webhookId };
  }

  const legacy = findByUrl(webhooks, legacyUrls);
  if (legacy) {
    const events = getEvents(legacy);
    const updated = await updateWebhook(legacy, targetUrl, events, true);
    console.log(`updated ${label}: ${legacy.url} -> ${targetUrl}`);
    return { events, webhookId: updated.webhookId };
  }

  const created = await createWebhook(targetUrl, defaultEvents);
  console.log(`created ${label}: ${targetUrl}`);
  return { events: defaultEvents, webhookId: created.webhookId };
};

const disableStale = async (webhooks, activeIds) => {
  const staleUrls = [...legacyProductionUrls, ...legacyLocalUrls];
  const staleWebhooks = webhooks.filter(
    (webhook) =>
      staleUrls.includes(webhook.url) && !activeIds.has(webhook.webhookId),
  );

  for (const webhook of staleWebhooks) {
    await updateWebhook(webhook, webhook.url, getEvents(webhook), false);
    console.log(`disabled stale webhook: ${webhook.url}`);
  }
};

const main = async () => {
  const webhooks = await listWebhooks();
  const production = await syncTarget({
    label: "production webhook",
    targetUrl: productionUrl,
    legacyUrls: legacyProductionUrls,
    webhooks,
  });
  const preview = await syncTarget({
    label: "preview webhook",
    targetUrl: previewUrl,
    legacyUrls: [],
    webhooks,
  });
  const local = await syncTarget({
    label: "local webhook",
    targetUrl: localUrl,
    legacyUrls: legacyLocalUrls,
    webhooks,
  });

  await disableStale(
    webhooks,
    new Set([production.webhookId, preview.webhookId, local.webhookId]),
  );

  console.log("Dynamic webhook sync complete.");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
