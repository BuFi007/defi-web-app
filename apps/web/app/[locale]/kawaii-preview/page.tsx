"use client";

import { useEffect, useState } from "react";
import { KawaiiGate, type Catalog } from "@/components/kawaii/kawaii-gate";

/** Dev preview of the Kawaii gate modal (no wallet gate) for visual QA. */
export default function KawaiiPreview() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    fetch("/api/kawaii/catalog").then((r) => r.json()).then(setCatalog).catch(() => {});
  }, []);
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0718] via-[#1a1340] to-[#0a0718]">
      {catalog ? <KawaiiGate catalog={catalog} /> : <p className="p-8 text-violet-300">loading catalog…</p>}
    </div>
  );
}
