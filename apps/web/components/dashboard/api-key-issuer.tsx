/**
 * Modal that surfaces a freshly-issued API key (Wave I4 — v0.1 local-stub).
 *
 * The full `<id>.<secret>` header is shown once. Once the user dismisses
 * the modal, the secret is still recoverable from `localStorage` for now —
 * but the README documents that this is a v0.1 stub. When the real
 * backend issuance route ships, the secret will only be visible HERE and
 * never again, so the UX is already shaped for that future contract.
 */

"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import type { DashboardApiKey } from "@/lib/dashboard/use-api-keys";

interface ApiKeyIssuerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issuedKey: DashboardApiKey | null;
}

export function ApiKeyIssuer({ open, onOpenChange, issuedKey }: ApiKeyIssuerProps) {
  const header = issuedKey ? `${issuedKey.id}.${issuedKey.secret}` : "";

  const handleCopy = async () => {
    if (!header) return;
    try {
      await navigator.clipboard.writeText(header);
    } catch {
      // Clipboard write rejected — surface nothing; user can manually copy.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Your new API key</DialogTitle>
        </DialogHeader>

        {issuedKey ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Copy this value now — once the real backend ships, the
              secret will only be displayed once at creation time. Today
              it's also persisted to <code>localStorage</code> as part of
              the v0.1 stub.
            </p>

            <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-xs break-all">
              {header}
            </div>

            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <div>
                <span className="text-foreground font-semibold">Key ID:</span>{" "}
                {issuedKey.id}
              </div>
              <div>
                <span className="text-foreground font-semibold">Label:</span>{" "}
                {issuedKey.label}
              </div>
              <div>
                Send as{" "}
                <code className="px-1 py-0.5 rounded bg-muted/60">
                  X-Bufi-Api-Key
                </code>{" "}
                on every request to
                <code className="ml-1 px-1 py-0.5 rounded bg-muted/60">
                  /webhooks/subscriptions
                </code>
                .
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={handleCopy}>Copy header</Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No key issued.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
