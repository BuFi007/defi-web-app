/**
 * One-time HMAC secret reveal modal (Wave I4).
 *
 * Used both after webhook creation AND after secret rotation — same shape:
 * show the secret once, never again. The subscription metadata is
 * persisted server-side; the secret hash is stored peppered, so we
 * physically cannot show it again on subsequent visits.
 */

"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface WebhookSecretRevealProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionId: string | null;
  secret: string | null;
  /** "create" → "Your new webhook secret"; "rotate" → "New secret issued". */
  mode: "create" | "rotate";
}

export function WebhookSecretReveal({
  open,
  onOpenChange,
  subscriptionId,
  secret,
  mode,
}: WebhookSecretRevealProps) {
  const handleCopy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
    } catch {
      // ignore — clipboard may be denied
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? "Your new webhook secret"
              : "New secret issued"}
          </DialogTitle>
        </DialogHeader>

        {secret && subscriptionId ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {mode === "create"
                ? "Copy this secret now — the server stores only a peppered hash, so it cannot be re-displayed."
                : "Old signatures fail immediately. Update your receiver to verify against the new secret before any new events arrive."}
            </p>

            <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-xs break-all">
              {secret}
            </div>

            <div className="text-xs text-muted-foreground">
              For subscription{" "}
              <code className="px-1 py-0.5 rounded bg-muted/60">
                {subscriptionId}
              </code>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                I copied it
              </Button>
              <Button onClick={handleCopy}>Copy secret</Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No secret available.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
