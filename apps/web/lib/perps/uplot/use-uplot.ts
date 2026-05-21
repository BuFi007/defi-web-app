"use client";

/**
 * React lifecycle wrapper around uPlot.
 *
 * Why: uPlot is an imperative canvas library. The naive `<uPlot />`-style
 * React wrapper that recreates the chart instance on every prop change
 * throws away the entire WebGL-adjacent canvas state and re-allocates
 * 1–2 MB of typed arrays on each book tick — which is the *exact* thing
 * we picked uPlot to avoid. So we keep the instance alive across renders
 * via a ref and only call `setData()` / `setSize()` on it.
 *
 * Lifecycle:
 *   - mount      → create container <div>, instantiate uPlot, attach.
 *   - data prop  → uplot.setData(data) (no re-instantiation).
 *   - resize     → ResizeObserver → uplot.setSize({width, height}).
 *   - opts prop  → DESTROY + RECREATE. uPlot's `setOpts` API was renamed
 *                  to `setSeries` / `setScale` mid-2023 and there is no
 *                  full re-config option; if the caller really needs to
 *                  swap axes / series, change `optsKey` to force a clean
 *                  remount. 99% of the time the caller passes a memoised
 *                  opts object and never changes it.
 *
 * The hook is SSR-safe: the uPlot instance is created inside `useEffect`,
 * which never runs on the server.
 */

import { useEffect, useRef } from "react";
import uPlot, { type AlignedData, type Options } from "uplot";

export interface UseUplotArgs {
  /** uPlot config — width/height are overridden by ResizeObserver. */
  opts: Options;
  /** Data tuple, [xs, ...ys]. uPlot expects aligned arrays. */
  data: AlignedData;
  /**
   * When this string changes, the hook tears down the uPlot instance and
   * creates a fresh one. Use for "I changed the # of series" or "I want
   * a different paths function" — anything beyond a plain data swap.
   *
   * Defaults to the empty string, so a memoised `opts` reference keeps
   * the chart alive forever (the right default).
   */
  optsKey?: string;
}

export interface UseUplotResult {
  /** Attach to the host <div> via `ref={containerRef}`. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Direct handle to the uPlot instance — useful for advanced callers. */
  instanceRef: React.RefObject<uPlot | null>;
}

export function useUplot(args: UseUplotArgs): UseUplotResult {
  const { opts, data, optsKey = "" } = args;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<uPlot | null>(null);

  // Stash the latest data + opts so the create-effect doesn't re-fire on
  // every render — it only depends on `optsKey` and the container ref.
  const dataRef = useRef<AlignedData>(data);
  const optsRef = useRef<Options>(opts);
  dataRef.current = data;
  optsRef.current = opts;

  // Mount / remount on optsKey change.
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    // Measure the host BEFORE creating the chart so the first paint is
    // correctly sized; otherwise uPlot defaults to whatever was in opts
    // (typically 300×150) and we get a one-frame flash.
    const rect = host.getBoundingClientRect();
    const initialOpts: Options = {
      ...optsRef.current,
      width: Math.max(1, Math.floor(rect.width)) || optsRef.current.width || 300,
      height:
        Math.max(1, Math.floor(rect.height)) || optsRef.current.height || 150,
    };

    const plot = new uPlot(initialOpts, dataRef.current, host);
    instanceRef.current = plot;

    return () => {
      plot.destroy();
      instanceRef.current = null;
    };
    // optsKey gates the full lifecycle — passing the same key across
    // renders keeps the same uPlot instance alive.
  }, [optsKey]);

  // Push new data into the live instance without destroying it.
  useEffect(() => {
    const plot = instanceRef.current;
    if (!plot) return;
    plot.setData(data);
  }, [data]);

  // ResizeObserver → setSize. Bound to the container; cleans up on
  // unmount via the ref-deref guard.
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const plot = instanceRef.current;
      if (!plot) return;
      const r = host.getBoundingClientRect();
      const w = Math.max(1, Math.floor(r.width));
      const h = Math.max(1, Math.floor(r.height));
      // uPlot guards against same-size setSize calls internally so a
      // no-op resize from a sibling layout doesn't cause a repaint.
      plot.setSize({ width: w, height: h });
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return { containerRef, instanceRef };
}
