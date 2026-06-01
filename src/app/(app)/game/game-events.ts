// Отдельный файл для событий игры без зависимости от Phaser
// Это позволяет импортировать gameEvents без загрузки Phaser при SSR

// ─── Типы событий ──────────────────────────────────────────────────────────
export interface GameEventMap {
  // Инвентарь
  'inventory-updated':  Record<string, number>;           // весь инвентарь обновился
  'block-collected':    { type: string; amount: number; baseId: string; biome: string }; // блок добыт
  'tile-placed':        { tile: string; itemKey: string; x: number; y: number };         // блок поставлен
  'item-given':         { tile: string; amount: number };                                 // предмет выдан AI

  // Игрок
  'player-moved':       { x: number; y: number; tx: number; ty: number };  // позиция изменилась
  'player-syncing':     { syncing: boolean };                               // AI генерирует

  // Карта / мир
  'map-generated':      { biome: string; rows: number };                    // новая карта от AI
  'biome-changed':      { biome: string };                                  // биом сменён
  'tiles-patched':      { from: string; to: string; count: number };        // глобальная замена
  'area-modified':      { count: number };                                   // точечные изменения
  'objects-placed':     { count: number };                                   // объекты рядом с игроком
  'structure-built':    { type: string; x: number; y: number; w: number; h: number }; // построена структура
  'world-saved':        Record<string, never>;                              // мир сохранён
  'map-regenerated':    Record<string, never>;                              // карта перегенерирована

  // Время суток
  'time-changed':       { time: 'day' | 'dusk' | 'night' | 'dawn' };

  // Эффекты
  'tile-broken':        { tile: string; itemKey: string; x: number; y: number }; // тайл сломан
  'tnt-exploded':       { x: number; y: number; radius: number };                // взрыв TNT

  // UI / misc
  'keyboard-focus':     { enabled: boolean };                               // фокус сменился
  'game-ready':         Record<string, never>;                              // сцена готова
}

type EventKey = keyof GameEventMap;
type Listener<K extends EventKey> = (data: GameEventMap[K]) => void;

export const gameEvents: {
  _listeners: Map<string, Set<(...args: any[]) => void>>;
  on<K extends EventKey>(event: K, fn: Listener<K>): void;
  on(event: string, fn: (...args: any[]) => void): void;
  off<K extends EventKey>(event: K, fn: Listener<K>): void;
  off(event: string, fn: (...args: any[]) => void): void;
  emit<K extends EventKey>(event: K, data: GameEventMap[K]): void;
  emit(event: string, ...args: any[]): void;
  once<K extends EventKey>(event: K, fn: Listener<K>): void;
  clear(event: string): void;
  clearAll(): void;
} = {
  _listeners: new Map<string, Set<(...args: any[]) => void>>(),

  on(event: string, fn: (...args: any[]) => void) {
    if (typeof window === 'undefined') return;
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(fn);
  },

  off(event: string, fn: (...args: any[]) => void) {
    if (typeof window === 'undefined') return;
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.delete(fn);
    }
  },

  emit(event: string, ...args: any[]) {
    if (typeof window === 'undefined') return;
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.forEach(fn => fn(...args));
    }
  },

  /** Подписка, которая автоматически отписывается после первого вызова */
  once<K extends EventKey>(event: K, fn: Listener<K>): void {
    const wrapper = (...args: any[]) => {
      fn(...args as [GameEventMap[K]]);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  },

  /** Снять ВСЕ слушатели конкретного события */
  clear(event: string) {
    this._listeners.delete(event);
  },

  /** Снять абсолютно все слушатели */
  clearAll() {
    this._listeners.clear();
  },
};