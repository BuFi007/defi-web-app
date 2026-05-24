/**
 * Integrator API-key issuance / storage (Wave I4 — v0.1).
 *
 * The API-key backend (`POST /integrators/keys`) is a TODO — see
 * `api-keys-README.md`. Until that route ships, this hook surfaces a
 * dev-mode local-stub flow:
 *
 *   1. "Generate dev key" — mints a random `<id>.<secret>` pair in the browser,
 *      persists it to `localStorage` under `BUFI_DASHBOARD_API_KEYS_V1`, and
 *      returns the one-time secret so the user can copy it before navigating
 *      away. The API backend's dev fallback (auth.ts) accepts any non-empty
 *      key, so the resulting key works against `/webhooks/subscriptions/*`.
 *   2. "Revoke" — removes the entry from `localStorage`. There is no
 *      server-side revocation yet; once a real issuance route exists this
 *      hook will additionally POST `DELETE /integrators/keys/:id`.
 *
 * Every consumer of the dashboard (use-webhooks, the page shells) reads the
 * currently-active key via `useActiveDashboardApiKey()` so the auth header
 * comes from one source of truth.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "BUFI_DASHBOARD_API_KEYS_V1";
const ACTIVE_KEY_ID = "BUFI_DASHBOARD_ACTIVE_KEY_V1";

export interface DashboardApiKey {
  id: string;
  /**
   * The HMAC secret half of `<id>.<secret>`. Stored locally in the v0.1 stub
   * because no backend exists yet — when a real issuance route lands the
   * secret will only be shown once at creation time and the secret will NOT
   * be persisted client-side beyond the issuance modal.
   */
  secret: string;
  label: string;
  createdAt: number;
}

interface StoredKeys {
  keys: DashboardApiKey[];
}

function readStorage(): StoredKeys {
  if (typeof window === "undefined") return { keys: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { keys: [] };
    const parsed = JSON.parse(raw) as StoredKeys;
    if (!parsed || !Array.isArray(parsed.keys)) return { keys: [] };
    return parsed;
  } catch {
    return { keys: [] };
  }
}

function writeStorage(next: StoredKeys): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  // Notify same-tab subscribers — `storage` only fires for OTHER tabs.
  window.dispatchEvent(new CustomEvent("bufi-dashboard-keys-changed"));
}

function readActiveId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_KEY_ID);
}

function writeActiveId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id === null) window.localStorage.removeItem(ACTIVE_KEY_ID);
  else window.localStorage.setItem(ACTIVE_KEY_ID, id);
  window.dispatchEvent(new CustomEvent("bufi-dashboard-keys-changed"));
}

function randomKeyId(): string {
  return `int_${randomHex(8)}`;
}

function randomSecret(): string {
  return randomHex(24);
}

function randomHex(byteLength: number): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Last-resort: dev-only stub, non-cryptographic.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(
    0,
    byteLength * 2,
  );
}

export function useDashboardApiKeys() {
  const [snapshot, setSnapshot] = useState<{
    keys: DashboardApiKey[];
    activeId: string | null;
  }>({ keys: [], activeId: null });

  // Initial load + cross-tab + same-tab subscription.
  useEffect(() => {
    const load = () => {
      setSnapshot({
        keys: readStorage().keys,
        activeId: readActiveId(),
      });
    };
    load();
    const onChange = () => load();
    window.addEventListener("storage", onChange);
    window.addEventListener("bufi-dashboard-keys-changed", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("bufi-dashboard-keys-changed", onChange);
    };
  }, []);

  const create = useCallback((label: string): DashboardApiKey => {
    const id = randomKeyId();
    const secret = randomSecret();
    const key: DashboardApiKey = {
      id,
      secret,
      label: label.trim() || "Untitled key",
      createdAt: Date.now(),
    };
    const next = readStorage();
    next.keys = [...next.keys, key];
    writeStorage(next);
    // Auto-activate the first key — saves the user a click.
    if (readActiveId() === null) writeActiveId(id);
    return key;
  }, []);

  const revoke = useCallback((id: string): void => {
    const next = readStorage();
    next.keys = next.keys.filter((k) => k.id !== id);
    writeStorage(next);
    if (readActiveId() === id) {
      writeActiveId(next.keys[0]?.id ?? null);
    }
  }, []);

  const setActive = useCallback((id: string | null): void => {
    writeActiveId(id);
  }, []);

  return useMemo(
    () => ({
      keys: snapshot.keys,
      activeId: snapshot.activeId,
      activeKey:
        snapshot.keys.find((k) => k.id === snapshot.activeId) ?? null,
      create,
      revoke,
      setActive,
    }),
    [snapshot, create, revoke, setActive],
  );
}

/**
 * Thin selector for "what header should I send right now". Returns null when
 * no key has been created yet — call sites either fall back to the dev
 * fallback (any non-empty key works in non-prod) or show the empty state.
 */
export function useActiveDashboardApiKey(): {
  id: string | null;
  header: string | null;
} {
  const { activeKey } = useDashboardApiKeys();
  if (!activeKey) return { id: null, header: null };
  return { id: activeKey.id, header: `${activeKey.id}.${activeKey.secret}` };
}
