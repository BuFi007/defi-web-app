"use client";

import { useEffect, useState } from "react";
import { KawaiiGate, type Catalog } from "@/components/kawaii/kawaii-gate";
import "@/css/trade-island/index.css";

/** Dev preview of the Kawaii gate, framed at the dynamic-island body size so the
 *  embedded layout can be QA'd for compactness without connecting a wallet.
 *  Mirrors the real wrapper: .identity-tab (padding overridden inline) inside a
 *  fixed-height island body. */
export default function KawaiiPreview() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    fetch("/api/kawaii/catalog").then((r) => r.json()).then(setCatalog).catch(() => {});
  }, []);
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "linear-gradient(135deg,#c9b8ff,#e9d8ff,#bfe3ff)", padding: 16 }}>
      {/* Mimics the island identity-tab body: width 1240, realistic body height. */}
      <div style={{ position: "relative", width: 1240, height: 440, borderRadius: 26, overflow: "hidden", boxShadow: "0 30px 80px rgba(60,20,110,.35)", background: "#fff" }}>
        <div className="identity-tab" style={{ position: "relative", height: "100%", minHeight: 380, flex: 1, padding: 10, margin: 0, maxWidth: "none", gap: 0, overflow: "hidden" }}>
          {catalog ? <KawaiiGate catalog={catalog} embedded /> : <p style={{ padding: 32 }}>loading catalog…</p>}
        </div>
      </div>
    </div>
  );
}
