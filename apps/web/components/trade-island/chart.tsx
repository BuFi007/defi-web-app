"use client";

import { useEffect, useRef, useState } from "react";
import { makeCandles, type Candle, type Market } from "./data";

export function CandleChart({ market, timeframe }: { market: Market; timeframe: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const candlesRef = useRef<Candle[]>([]);

  useEffect(() => {
    candlesRef.current = makeCandles(market.price, 120);
  }, [market.sym, market.price]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const cv = canvasRef.current;
      const wrap = wrapRef.current;
      if (!cv || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      if (cv.width !== W * dpr || cv.height !== H * dpr) {
        cv.width = W * dpr;
        cv.height = H * dpr;
        cv.style.width = W + "px";
        cv.style.height = H + "px";
      }
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const root = getComputedStyle(document.documentElement);
      const colorBorder = root.getPropertyValue("--border").trim() || "#ebe4ff";
      const colorInk3 = root.getPropertyValue("--ink-3").trim() || "#7c70a8";
      const colorInk4 = root.getPropertyValue("--ink-4").trim() || "#b6abd6";
      const profit = root.getPropertyValue("--profit").trim() || "#a89ce8";
      const loss = root.getPropertyValue("--loss").trim() || "#ffecb4";
      const profitInk = root.getPropertyValue("--profit-ink").trim() || profit;
      const lossInk = root.getPropertyValue("--loss-ink").trim() || loss;

      const data = candlesRef.current;
      if (!data.length) return;

      const padLeft = 8;
      const padRight = 70;
      const padTop = 14;
      const padBottom = 80;
      const plotW = W - padLeft - padRight;
      const plotH = H - padTop - padBottom;
      const volH = 50;

      let lo = Infinity;
      let hi = -Infinity;
      for (const c of data) {
        if (c.l < lo) lo = c.l;
        if (c.h > hi) hi = c.h;
      }
      const pad = (hi - lo) * 0.08;
      lo -= pad;
      hi += pad;
      const yOf = (v: number) => padTop + (1 - (v - lo) / (hi - lo)) * plotH;

      const volMax = Math.max(...data.map((d) => d.v));
      const volYOf = (v: number) => H - padBottom + volH - (v / volMax) * volH + 24;

      const candleW = Math.max(2, plotW / data.length - 1.5);
      const xOf = (i: number) => padLeft + i * (plotW / data.length) + plotW / data.length / 2;

      ctx.strokeStyle = colorBorder;
      ctx.lineWidth = 1;
      const steps = 6;
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillStyle = colorInk4;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (let i = 0; i <= steps; i++) {
        const y = padTop + (i / steps) * plotH;
        const v = hi - (i / steps) * (hi - lo);
        ctx.beginPath();
        ctx.setLineDash([2, 4]);
        ctx.moveTo(padLeft, y);
        ctx.lineTo(W - padRight, y);
        ctx.stroke();
        const dec = v < 10 ? 4 : v < 1000 ? 2 : 1;
        ctx.fillText(v.toFixed(dec), W - padRight + 8, y);
      }
      ctx.setLineDash([]);

      ctx.strokeStyle = colorBorder;
      for (let i = 0; i < data.length; i += 16) {
        const x = xOf(i);
        ctx.beginPath();
        ctx.setLineDash([2, 4]);
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, H - padBottom);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        const x = xOf(i);
        const up = d.c >= d.o;
        const vy = volYOf(d.v);
        const vH = H - padBottom + 24 - vy;
        ctx.fillStyle = up ? profit + "33" : loss + "33";
        ctx.fillRect(x - candleW / 2, vy, candleW, vH);
      }

      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        const x = xOf(i);
        const up = d.c >= d.o;
        const wickColor = up ? profitInk : lossInk;
        ctx.strokeStyle = wickColor;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(x, yOf(d.h));
        ctx.lineTo(x, yOf(d.l));
        ctx.stroke();
        const bodyTop = yOf(Math.max(d.o, d.c));
        const bodyBot = yOf(Math.min(d.o, d.c));
        const bodyH = Math.max(1.5, bodyBot - bodyTop);
        const r = Math.min(candleW * 0.25, bodyH * 0.25, 3);
        ctx.beginPath();
        const bx = x - candleW / 2;
        const by = bodyTop;
        const bw = candleW;
        const bh = bodyH;
        ctx.moveTo(bx + r, by);
        ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
        ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
        ctx.arcTo(bx, by + bh, bx, by, r);
        ctx.arcTo(bx, by, bx + bw, by, r);
        ctx.closePath();
        ctx.fillStyle = up ? profit : loss;
        ctx.fill();
        ctx.strokeStyle = wickColor;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const last = data[data.length - 1];
      const lastY = yOf(last.c);
      const up = last.c >= last.o;
      const tagColor = up ? profit : loss;
      const tagTextColor = up ? "#ffffff" : lossInk;
      ctx.strokeStyle = up ? profitInk : lossInk;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, lastY);
      ctx.lineTo(W - padRight, lastY);
      ctx.stroke();
      ctx.setLineDash([]);

      const tagW = 64;
      const tagH = 22;
      const tagX = W - padRight + 2;
      ctx.fillStyle = tagColor;
      const ty = Math.max(padTop + tagH / 2, Math.min(H - padBottom - tagH / 2, lastY));
      ctx.beginPath();
      const rr = 6;
      ctx.moveTo(tagX + rr, ty - tagH / 2);
      ctx.arcTo(tagX + tagW, ty - tagH / 2, tagX + tagW, ty + tagH / 2, rr);
      ctx.arcTo(tagX + tagW, ty + tagH / 2, tagX, ty + tagH / 2, rr);
      ctx.arcTo(tagX, ty + tagH / 2, tagX, ty - tagH / 2, rr);
      ctx.arcTo(tagX, ty - tagH / 2, tagX + tagW, ty - tagH / 2, rr);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = tagTextColor;
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const dec = last.c < 10 ? 4 : last.c < 1000 ? 2 : 1;
      ctx.fillText(last.c.toFixed(dec), tagX + tagW / 2, ty);

      if (hover) {
        const { x: hx, y: hy } = hover;
        ctx.strokeStyle = colorInk3;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hx, padTop);
        ctx.lineTo(hx, H - padBottom);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(padLeft, hy);
        ctx.lineTo(W - padRight, hy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    draw();
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    const tick = () => {
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, [market.sym, hover, timeframe]);

  return (
    <div
      ref={wrapRef}
      className="chart-area"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setHover({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseLeave={() => setHover(null)}
    >
      <canvas ref={canvasRef} className="chart-canvas" />
    </div>
  );
}
