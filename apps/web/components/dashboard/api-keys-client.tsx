/**
 * Client surface for /dashboard/api-keys (Wave I4 — v0.1).
 *
 * Composes the issuer form, issued-key modal, and the table of existing
 * keys against `useDashboardApiKeys`. Also renders the v0.1 disclosure
 * banner explaining that issuance is a local-only stub.
 */

"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  useDashboardApiKeys,
  type DashboardApiKey,
} from "@/lib/dashboard/use-api-keys";

import { ApiKeyIssuer } from "./api-key-issuer";
import { ApiKeyTable } from "./api-key-table";

export function ApiKeysClient() {
  const { keys, activeId, create, revoke, setActive } = useDashboardApiKeys();

  const [label, setLabel] = useState("");
  const [issuedKey, setIssuedKey] = useState<DashboardApiKey | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const handleCreate = () => {
    const key = create(label || "Untitled key");
    setIssuedKey(key);
    setModalOpen(true);
    setLabel("");
  };

  return (
    <div className="flex flex-col gap-6">
      <Disclosure />

      <section className="rounded-lg border border-border bg-card p-5 flex flex-col gap-3">
        <div>
          <h3 className="text-base font-semibold">Generate a new API key</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Label the key so you can tell them apart later. The secret is
            shown once after creation — copy it before closing the dialog.
          </p>
        </div>
        <div className="flex flex-col md:flex-row gap-3">
          <Input
            placeholder="Label (e.g. backfill-bot, prod-relay)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="New API key label"
            className="flex-1"
          />
          <Button onClick={handleCreate}>Generate dev key</Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Your API keys</h3>
          <span className="text-xs text-muted-foreground">
            {keys.length} key{keys.length === 1 ? "" : "s"} · active:{" "}
            <code className="px-1 py-0.5 rounded bg-muted/60 text-xs">
              {activeId ?? "none"}
            </code>
          </span>
        </div>

        <ApiKeyTable
          keys={keys}
          activeId={activeId}
          onSetActive={setActive}
          onRevoke={revoke}
        />
      </section>

      <ApiKeyIssuer
        open={modalOpen}
        onOpenChange={setModalOpen}
        issuedKey={issuedKey}
      />
    </div>
  );
}

function Disclosure() {
  return (
    <div className="rounded-md border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 p-4 text-xs leading-relaxed">
      <div className="font-semibold text-amber-900 dark:text-amber-100">
        v0.1 — local-stub key issuance
      </div>
      <p className="text-amber-900/90 dark:text-amber-100/80 mt-1">
        The backend route to issue real API keys hasn't shipped yet.
        Today this page mints keys in the browser and stores them under{" "}
        <code className="px-1 py-0.5 rounded bg-amber-100/80 dark:bg-amber-900/40">
          localStorage["BUFI_DASHBOARD_API_KEYS_V1"]
        </code>
        . They work end-to-end against{" "}
        <code className="px-1 py-0.5 rounded bg-amber-100/80 dark:bg-amber-900/40">
          /webhooks/subscriptions
        </code>{" "}
        because the API's dev fallback accepts any non-empty header value
        outside production. See{" "}
        <code className="px-1 py-0.5 rounded bg-amber-100/80 dark:bg-amber-900/40">
          apps/web/lib/dashboard/api-keys-README.md
        </code>{" "}
        for the migration path.
      </p>
    </div>
  );
}
