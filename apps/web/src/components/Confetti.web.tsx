/**
 * Confetti on the web — a canvas particle system, ported straight from the
 * signed-off prototype (Welcome screens, 1h). Ink, moss, lime and cream rects,
 * dots and pins are thrown from a point, fall under gravity with a little drag,
 * tumble, and fade out over the last of their life.
 *
 * Bursts are given in the handoff's 390×844 design space; this scales them to
 * whatever the phone frame actually is. The canvas is drawn at device pixel
 * ratio so the pins stay crisp.
 */
import React, { useEffect, useImperativeHandle, useRef } from 'react';
import { INK, MOSS, CREAM, LIME } from '../theme';
import type { ConfettiHandle, BurstOpts } from './Confetti';

export type { ConfettiHandle, BurstOpts } from './Confetti';

// The pin outline the prototype throws, at 100×100 (Path2D units).
const PIN = 'M50 0 C26 0 8 18 8 42 C8 68 50 100 50 100 C50 100 92 68 92 42 C92 18 74 0 50 0 Z';

// The four brand colours the bursts pull from, in the app's own hexes so a
// confetti piece is the same lime as the wordmark it lands beside.
export const CONFETTI = { INK, MOSS, CREAM, LIME };

type Part = {
  x: number; y: number; vx: number; vy: number; g: number; drag: number;
  rot: number; vr: number; flip: number; vf: number; size: number;
  age: number; life: number; shape: 'rect' | 'dot' | 'pin'; color: string;
};

export const Confetti = React.forwardRef<ConfettiHandle, { width: number; height: number }>(
  function Confetti({ width, height }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const parts = useRef<Part[]>([]);
    const raf = useRef<number | null>(null);
    const last = useRef(0);
    const dead = useRef(false);
    // The design was drawn at 390×844; every burst coordinate and throw is in
    // that space, and scaled here to the real frame.
    const sx = width / 390;
    const sy = height / 844;

    useEffect(() => {
      dead.current = false;
      return () => {
        dead.current = true;
        if (raf.current != null) cancelAnimationFrame(raf.current);
      };
    }, []);

    const draw = (t: number) => {
      const cv = canvasRef.current;
      if (!cv || dead.current) return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
      const W = width, H = height;
      const dt = Math.min(0.05, (t - (last.current || t)) / 1000);
      last.current = t;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      parts.current = parts.current.filter((p) => p.y < H + 60 && p.age < p.life);
      const pin = new Path2D(PIN);
      for (const p of parts.current) {
        p.age += dt;
        p.vy += p.g * dt;
        const d = Math.pow(p.drag, dt * 60);
        p.vx *= d; p.vy *= d;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot += p.vr * dt; p.flip += p.vf * dt;
        ctx.globalAlpha = Math.max(0, Math.min(1, (p.life - p.age) / 0.6));
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.shape === 'rect') {
          ctx.scale(1, Math.cos(p.flip));
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        } else if (p.shape === 'dot') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, 6.283);
          ctx.fill();
        } else {
          const k = p.size / 100;
          ctx.scale(k * Math.cos(p.flip), k);
          ctx.translate(-50, -50);
          ctx.fill(pin);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (parts.current.length) {
        raf.current = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, W, H);
        raf.current = null;
      }
    };

    const start = () => {
      if (raf.current == null && !dead.current) {
        last.current = 0;
        raf.current = requestAnimationFrame(draw);
      }
    };

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          parts.current = [];
          if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; }
          const ctx = canvasRef.current?.getContext('2d');
          ctx?.clearRect(0, 0, width, height);
        },
        burst: (bx: number, by: number, o: BurstOpts) => {
          const x = bx * sx, y = by * sy;
          const scale = Math.min(sx, sy);
          for (let i = 0; i < (o.n ?? 80); i++) {
            const a = (o.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
            const v = (o.power ?? 700) * (0.3 + Math.random() * 0.7) * scale;
            parts.current.push({
              x, y,
              vx: Math.cos(a) * v, vy: Math.sin(a) * v,
              g: (o.g ?? 900) * scale, drag: o.drag ?? 0.95,
              rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
              flip: Math.random() * 6, vf: 4 + Math.random() * 9,
              size: (o.size ?? 10) * (0.6 + Math.random() * 0.8) * scale,
              age: 0, life: o.life ?? 4,
              color: o.colors[Math.floor(Math.random() * o.colors.length)],
              shape: o.shapes[Math.floor(Math.random() * o.shapes.length)],
            });
          }
          start();
        },
      }),
      [sx, sy, width, height],
    );

    const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    return (
      <canvas
        ref={canvasRef}
        width={Math.round(width * dpr)}
        height={Math.round(height * dpr)}
        style={{ position: 'absolute', inset: 0, width, height, pointerEvents: 'none', zIndex: 40 }}
      />
    );
  },
);
