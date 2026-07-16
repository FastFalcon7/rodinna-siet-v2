import { useRef, useState } from 'react';

/**
 * Fotka so zoomom pre lightbox (ladenie 07/2026, bod 1 — na iPhone sa fotky
 * nedali priblížiť). Vlastná implementácia (bez knižnice, v duchu zvyšku appky):
 *
 * - dotyk: dva prsty = pinch zoom, dvojklik/double-tap = 1× ↔ 2×, ťahanie pri
 *   priblížení = posun (pan)
 * - desktop: dvojklik prepína zoom, koliesko zoomuje, ťahanie myšou posúva
 *
 * Kým je fotka priblížená, komponent zožerie (stopPropagation) dotykové gestá,
 * aby rodičovský lightbox nelistoval/nezatváral pri posúvaní. Pri mierke 1 gestá
 * necháva prebublať → listovanie a zatvorenie swipom fungujú ako predtým.
 */
const MAX_SCALE = 4;

type Gesture =
  | { mode: 'pinch'; startDist: number; startScale: number; startTx: number; startTy: number }
  | { mode: 'pan'; startX: number; startY: number; startTx: number; startTy: number }
  | null;

export function ZoomableImage({ src, alt = '' }: { src: string; alt?: string }) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const gesture = useRef<Gesture>(null);
  const lastTap = useRef(0);
  const mouse = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const active = gesture.current !== null || mouse.current !== null;

  const dist = (t: React.TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(1, s));

  /** Obmedzí posun tak, aby fotka neušla úplne mimo rámik. */
  const clampT = (x: number, y: number, s: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    const maxX = r ? (r.width * (s - 1)) / 2 : 0;
    const maxY = r ? (r.height * (s - 1)) / 2 : 0;
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  };

  const reset = () => {
    setScale(1);
    setTx(0);
    setTy(0);
  };

  const zoomTo = (s: number) => {
    const ns = clampScale(s);
    setScale(ns);
    if (ns === 1) {
      setTx(0);
      setTy(0);
    } else {
      const c = clampT(tx, ty, ns);
      setTx(c.x);
      setTy(c.y);
    }
  };

  // ── Dotyk ──────────────────────────────────────────────────────────────────
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      gesture.current = { mode: 'pinch', startDist: dist(e.touches), startScale: scale, startTx: tx, startTy: ty };
      e.stopPropagation();
      return;
    }
    if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        // Double-tap: prepni 1× ↔ 2×.
        lastTap.current = 0;
        zoomTo(scale > 1 ? 1 : 2);
        e.stopPropagation();
        return;
      }
      lastTap.current = now;
      if (scale > 1) {
        gesture.current = { mode: 'pan', startX: e.touches[0]!.clientX, startY: e.touches[0]!.clientY, startTx: tx, startTy: ty };
        e.stopPropagation();
      }
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.mode === 'pinch' && e.touches.length === 2) {
      const ns = clampScale(g.startScale * (dist(e.touches) / g.startDist));
      const c = clampT(g.startTx, g.startTy, ns);
      setScale(ns);
      setTx(c.x);
      setTy(c.y);
      e.stopPropagation();
    } else if (g.mode === 'pan' && e.touches.length === 1) {
      const c = clampT(g.startTx + (e.touches[0]!.clientX - g.startX), g.startTy + (e.touches[0]!.clientY - g.startY), scale);
      setTx(c.x);
      setTy(c.y);
      e.stopPropagation();
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (gesture.current) e.stopPropagation();
    if (e.touches.length === 0) {
      gesture.current = null;
      if (scale <= 1.02) reset();
    }
  };

  // ── Desktop ─────────────────────────────────────────────────────────────────
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return;
    e.stopPropagation();
    zoomTo(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    mouse.current = { x: e.clientX, y: e.clientY, tx, ty };
    e.stopPropagation();
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const m = mouse.current;
    if (!m) return;
    const c = clampT(m.tx + (e.clientX - m.x), m.ty + (e.clientY - m.y), scale);
    setTx(c.x);
    setTy(c.y);
  };
  const endMouse = () => {
    mouse.current = null;
  };

  return (
    <div
      ref={wrapRef}
      className="flex h-full w-full touch-none items-center justify-center overflow-hidden"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endMouse}
      onMouseLeave={endMouse}
      onDoubleClick={(e) => {
        e.stopPropagation();
        zoomTo(scale > 1 ? 1 : 2);
      }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
          transition: active ? 'none' : 'transform 0.15s ease-out',
          cursor: scale > 1 ? 'grab' : 'auto',
        }}
        className="max-h-full max-w-full select-none object-contain"
      />
    </div>
  );
}
