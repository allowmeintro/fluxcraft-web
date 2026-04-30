"use client";
 
import React, { useEffect, useRef } from "react";
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
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100vh',
        display: 'block',
        backgroundColor: '#0a0a0a',
        overflow: 'hidden',
        position: 'relative',
      }}
      role="application"
      aria-label="Game Canvas"
    />
  );
}