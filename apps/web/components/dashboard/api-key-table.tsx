/**
 * Local-stub API-key list (Wave I4 — v0.1).
 *
 * Renders the keys persisted to `localStorage` by `useDashboardApiKeys`.
 * Each row exposes:
 *
 *   - "Use this key" — sets the active key (every other dashboard call
 *     reads the active key when building the X-Bufi-Api-Key header).
 *   - "Revoke" — drops the key from localStorage.
 *
 * The secret is NOT re-displayed after issuance, even though it's still
 * recoverable from localStorage today. That keeps the v0.1 UX consistent
 * with the future contract (real backend → one-time secret display only).
 */

"use client";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { DashboardApiKey } from "@/lib/dashboard/use-api-keys";

interface ApiKeyTableProps {
  keys: DashboardApiKey[];
  activeId: string | null;
  onSetActive: (id: string) => void;
  onRevoke: (id: string) => void;
}

export function ApiKeyTable({
  keys,
  activeId,
  onSetActive,
  onRevoke,
}: ApiKeyTableProps) {
  if (keys.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
        No API keys yet. Generate one using the form above.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead>Key ID</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((key) => {
            const isActive = key.id === activeId;
            return (
              <TableRow key={key.id}>
                <TableCell className="font-medium">{key.label}</TableCell>
                <TableCell className="font-mono text-xs">{key.id}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(key.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  {isActive ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5">
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5">
                      Idle
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  {!isActive && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onSetActive(key.id)}
                    >
                      Use this key
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => onRevoke(key.id)}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
