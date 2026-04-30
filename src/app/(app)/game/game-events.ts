// Отдельный файл для событий игры без зависимости от Phaser
// Это позволяет импортировать gameEvents без загрузки Phaser при SSR

export const gameEvents = {
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
};