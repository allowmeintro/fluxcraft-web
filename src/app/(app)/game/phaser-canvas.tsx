"use client";
 
import React, { useEffect, useRef, memo } from "react";

const AnimatedBackground = memo(function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let t = 0;

    type Particle = { x: number; y: number; vx: number; vy: number; size: number; alpha: number; hue: number; pulse: number };
    const particles: Particle[] = [];

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < 140; i++) {
      particles.push({
        x: Math.random() * (canvas.width || 800),
        y: Math.random() * (canvas.height || 600),
        vx: (Math.random() - 0.5) * 0.35,
        vy: -Math.random() * 0.55 - 0.1,
        size: Math.random() * 2.5 + 0.5,
        alpha: Math.random(),
        hue: Math.random() > 0.65 ? 30 : 20,
        pulse: Math.random() * Math.PI * 2,
      });
    }

    const draw = () => {
      t += 0.007;
      const W = canvas.width || 1;
      const H = canvas.height || 1;

      ctx.clearRect(0, 0, W, H);

      // 1. Фон
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, W, H);

      // 2. Пульсирующий радиальный градиент
      const cx = W / 2 + Math.sin(t * 0.5) * W * 0.06;
      const cy = H / 2 + Math.cos(t * 0.4) * H * 0.05;
      const r1 = Math.min(W, H) * (0.5 + Math.sin(t * 0.7) * 0.1);
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r1);
      grd.addColorStop(0,   `rgba(234,88,12,${0.07 + Math.sin(t) * 0.03})`);
      grd.addColorStop(0.5, `rgba(160,40,0,${0.03 + Math.sin(t * 1.3) * 0.015})`);
      grd.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);

      // 3. Движущаяся сетка
      const CELL = 38;
      const gridAlpha = 0.08 + Math.sin(t * 0.6) * 0.025;
      ctx.save();
      ctx.strokeStyle = `rgba(234,88,12,${gridAlpha})`;
      ctx.lineWidth = 0.5;
      const ox = (t * 7) % CELL;
      const oy = (t * 4.5) % CELL;
      for (let x = -CELL + ox; x < W + CELL; x += CELL) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = -CELL + oy; y < H + CELL; y += CELL) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.restore();

      // 4. Волны энергии
      for (let w = 0; w < 3; w++) {
        const wt = t * (0.35 + w * 0.12) + w * 2.0;
        const wy = H * (0.25 + w * 0.25) + Math.sin(wt * 0.7) * H * 0.06;
        ctx.save();
        ctx.strokeStyle = `rgba(251,146,60,${0.05 + Math.sin(wt) * 0.025})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 3) {
          const y = wy
            + Math.sin((x / W) * Math.PI * 5 + wt * 1.4) * 16
            + Math.sin((x / W) * Math.PI * 9 + wt * 0.7) * 7;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // 5. Световые лучи
      for (let r = 0; r < 3; r++) {
        const rt = t * 0.12 + r * (Math.PI * 2 / 3);
        const sX = W * 0.5 + Math.cos(rt) * W * 0.55;
        const sY = H * 0.5 + Math.sin(rt) * H * 0.55;
        const eX = W * 0.5 - Math.cos(rt) * W * 0.25;
        const eY = H * 0.5 - Math.sin(rt) * H * 0.25;
        const rGrd = ctx.createLinearGradient(sX, sY, eX, eY);
        rGrd.addColorStop(0, "rgba(0,0,0,0)");
        rGrd.addColorStop(0.5, `rgba(234,88,12,${0.025 + Math.sin(rt * 2) * 0.012})`);
        rGrd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.save();
        ctx.strokeStyle = rGrd;
        ctx.lineWidth = 70;
        ctx.beginPath();
        ctx.moveTo(sX, sY);
        ctx.lineTo(eX, eY);
        ctx.stroke();
        ctx.restore();
      }

      // 6. Частицы
      for (const p of particles) {
        p.x += p.vx + Math.sin(t + p.pulse) * 0.12;
        p.y += p.vy;
        p.pulse += 0.018;
        p.alpha += 0.007;
        if (p.y < -10 || p.alpha > 1.2) {
          p.x = Math.random() * W;
          p.y = H + 10;
          p.alpha = 0;
          p.vy = -Math.random() * 0.55 - 0.1;
          p.vx = (Math.random() - 0.5) * 0.35;
        }
        const a = Math.min(p.alpha, 1) * (0.35 + Math.sin(p.pulse) * 0.25);
        if (a <= 0) continue;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = `hsl(${p.hue}, 95%, 62%)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4.5);
        glow.addColorStop(0, `hsla(${p.hue}, 95%, 62%, 0.35)`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 7. Угловые свечения
      [[0,0],[W,0],[0,H],[W,H]].forEach(([qx, qy], i) => {
        const qGrd = ctx.createRadialGradient(qx, qy, 0, qx, qy, Math.min(W,H) * 0.28);
        qGrd.addColorStop(0, `rgba(234,88,12,${0.055 + Math.sin(t * 0.7 + i) * 0.025})`);
        qGrd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = qGrd;
        ctx.fillRect(0, 0, W, H);
      });

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }}
    />
  );
});
import { createPhaserGame, type GameCallbacks, type PhaserGameInstance, type TileId, type Inventory, type InventoryWithBiomes } from "./phaser-game";
 
export interface PhaserCanvasProps {
  getSelectedTile: () => TileId;
  getSelectedItem: () => string;
  onInventory: (inv: Inventory) => void;
  onInventoryWithBiomes?: (inv: InventoryWithBiomes) => void;
}
 
export default function PhaserCanvas({ 
  getSelectedTile,
  getSelectedItem,
  onInventory, 
  onInventoryWithBiomes 
}: PhaserCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameInstanceRef = useRef<PhaserGameInstance | null>(null);
  // Флаг монтирования — предотвращает двойной запуск в React StrictMode
  const initializedRef = useRef(false);
 
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initializedRef.current) return;
 
    const container = containerRef.current;
    if (!container) return;
 
    initializedRef.current = true;
 
    // Ждём реального размера контейнера через ResizeObserver
    // (clientWidth может быть 0 сразу после монтирования)
    const startGame = () => {
      if (gameInstanceRef.current) return; // уже запущена
 
      const callbacks: GameCallbacks = {
        parent: container,
        getSelectedTile,
        getSelectedItem,
        onInventory,
        onInventoryWithBiomes,
      };
 
      try {
        const instance = createPhaserGame(callbacks);
        gameInstanceRef.current = instance;
        console.log('[PhaserCanvas] Игра запущена');
      } catch (err) {
        console.error('[PhaserCanvas] Ошибка запуска Phaser:', err);
      }
    };
 
    // Если контейнер уже имеет размер — стартуем сразу, иначе ждём
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      startGame();
    } else {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            ro.disconnect();
            startGame();
            break;
          }
        }
      });
      ro.observe(container);
      return () => ro.disconnect();
    }
 
    return () => {
      if (gameInstanceRef.current) {
        console.log('[PhaserCanvas] Уничтожение игры');
        gameInstanceRef.current.destroy();
        gameInstanceRef.current = null;
      }
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
 
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <AnimatedBackground />
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          backgroundColor: 'transparent',
          overflow: 'hidden',
          position: 'relative',
          zIndex: 1,
        }}
        role="application"
        aria-label="Game Canvas"
      />
    </div>
  );
}