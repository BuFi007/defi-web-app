
import { useEffect, useRef, useCallback, useState } from 'react'
import { RealtimeClient } from '@openai/realtime-api-beta'

/**
 * Voice realtime client. Two operating modes:
 *
 * 1. RELAY (default, production-safe):
 *      - Connect to /api/voice/realtime (Next.js route, server-side).
 *      - The browser never sees the OpenAI API key.
 *      - You can also opt into a custom relay via
 *        NEXT_PUBLIC_APP_LOCAL_RELAY_SERVER_URL=http://localhost:8080
 *
 * 2. DIRECT-FROM-BROWSER (development only):
 *      - Gated behind NEXT_PUBLIC_VOICE_DIRECT_MODE === "1".
 *      - API key is read from sessionStorage (NOT localStorage), so it
 *        clears the moment the tab closes. Previously we used
 *        localStorage which persisted the key forever across sessions
 *        and was readable by any script on the origin.
 *      - dangerouslyAllowAPIKeyInBrowser is only enabled in this mode.
 *
 * Threat model fixed:
 *   - localStorage persistence → XSS / extension exfiltration window.
 *   - Production builds with the dev path on by default → silent fallback
 *     into "ship the key" mode.
 */

export const LOCAL_RELAY_SERVER_URL: string =
  process.env.NEXT_PUBLIC_APP_LOCAL_RELAY_SERVER_URL || '';

const VOICE_DIRECT_MODE = process.env.NEXT_PUBLIC_VOICE_DIRECT_MODE === '1';

// Default relay endpoint — the Next.js route handler that proxies to
// OpenAI server-side, keeping the API key off the wire. Returns 501
// until wired (see app/api/voice/realtime/route.ts).
const DEFAULT_RELAY_PATH = '/api/voice/realtime';


export default function useRealtimeClient() {
  const [client, setClient] = useState<RealtimeClient | null>(null);
  const clientRef = useRef<RealtimeClient | null>(null);

  useEffect(() => {
    // Resolve relay URL: explicit env override > built-in default route.
    const relayUrl = LOCAL_RELAY_SERVER_URL || DEFAULT_RELAY_PATH;

    let newClient: RealtimeClient | null = null;

    if (VOICE_DIRECT_MODE) {
      // Dev-only: allow a session-scoped API key. sessionStorage clears
      // on tab close, so the key cannot survive a refresh of the
      // browser process — much smaller blast radius than localStorage.
      const storedApiKey =
        (typeof window !== 'undefined'
          ? window.sessionStorage.getItem('tmp::voice_api_key')
          : null) || '';
      if (storedApiKey) {
        newClient = new RealtimeClient({
          apiKey: storedApiKey,
          dangerouslyAllowAPIKeyInBrowser: true,
        });
      }
    } else {
      // Production / default: always proxy through a relay. The relay
      // never returns the key to the browser; it forwards transport
      // events on a server-managed OpenAI socket.
      newClient = new RealtimeClient({ url: relayUrl });
    }

    if (newClient) {
      clientRef.current = newClient;
      setClient(newClient);
    }

    return () => {
      // Use the ref so we always tear down the *current* client, not a
      // stale closure capture from a prior render.
      if (clientRef.current) {
        clientRef.current.reset();
        clientRef.current = null;
      }
    };
  }, []);

  const getClient = useCallback(() => {
    if (!client) {
      throw new Error('RealtimeClient not initialized');
    }
    return client;
  }, [client]);

  return { getClient, isReady: !!client };
}
