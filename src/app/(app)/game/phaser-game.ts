import * as Phaser from 'phaser';
import { gameEvents } from './game-events';
import { LoadingScene } from './LoadingScene';

// Константы карты
export const MAP_W = 64;
export const MAP_H = 64;
export const TILE_SIZE = 32;

// Типы тайлов (базовые + новые объекты)
export type TileId = 
  | "grass" | "water" | "rock" | "tree" | "ruins" | "empty"
  | "ice" | "mythic_grass" | "mythic_rock" | "crystal" | "snowball"
  | "frozen_lake" | "quartz" | "board" | "glass" | "concrete"
  | "plant" | "glowing_mushroom" | "ash" | "coral";

// Биомные типы тайлов (для инвентаря с биомами)
export type BiomeTileId = 
  | TileId
  | "cactus"
  | "pine_tree"
  | "magma_rock"
  | "sand_rock"
  | "snow_rock"
  | "snow_grass"
  | "sand"
  | "grass_snow"
  | "grass_magma"
  | "grass_sand"
  | "tree_snow"
  | "tree_magma"
  | "tree_sand"
  | "rock_snow"
  | "rock_magma"
  | "rock_sand"
  | "ruins_snow"
  | "ruins_magma"
  | "ruins_sand";

// Тип времени суток
export type TimeOfDay = "day" | "dusk" | "night" | "dawn";

// Типы биомов для терраформирования
export type BiomeType = "default" | "lava" | "desert" | "snow";

// Элемент инвентаря с информацией о биоме
export interface InventoryItem {
  id: TileId;
  type: BiomeType;
  count: number;
}

// Элемент инвентаря с полными метаданными (tint, scale)
export interface InventoryItemWithMetadata {
  id: TileId;
  type: BiomeType;
  tint: number | undefined;
  scale: number;
  count: number;
}

// Типы для инвентаря и колбэков
export type Inventory = Partial<Record<TileId, number>>;

// Расширенный инвентарь с биомами и метаданными
export type InventoryWithBiomes = Record<string, InventoryItemWithMetadata>;

export interface GameCallbacks {
  parent: HTMLElement;
  getSelectedTile: () => TileId;
  getSelectedItem: () => string; // полный ключ инвентаря (может быть 'grass', 'tree_snow', 'rock_magma' и т.д.)
  onInventory: (inv: Inventory) => void;
  onInventoryWithBiomes?: (inv: InventoryWithBiomes) => void;
}

export interface PhaserGameHandle {
  regenerateProceduralMap: () => void;
  applyAiBiomeBackground: (url: string) => Promise<void>;
  saveWorld: () => void;
}

export interface PhaserGameInstance {
  destroy: () => void;
  handle: PhaserGameHandle;
}

// Простой генератор случайных чисел (Mulberry32)
function mulberry32(seed: number) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

// Фрактальный шум (fractional Brownian motion)
function fbm(x: number, y: number, seed: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    const nx = x * frequency + seed;
    const ny = y * frequency + seed * 2;
    value += amplitude * (Math.sin(nx * 0.1) * Math.cos(ny * 0.1) + 1) * 0.5;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / (1 - Math.pow(0.5, octaves));
}

class MainScene extends Phaser.Scene {
  private tiles: TileId[][] = [];
  private tileSprites: Phaser.GameObjects.Image[] = [];
  private player!: Phaser.GameObjects.Sprite;
  private playerGlow!: Phaser.GameObjects.Container;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: { [key: string]: Phaser.Input.Keyboard.Key };
  private fKey!: Phaser.Input.Keyboard.Key;
  private biomeSeed: number = 42;
  private rng: () => number = mulberry32(42);
  private inventory: Inventory = {};
  private onInventory: (inv: Inventory) => void = () => {};
  private getSelectedTile: () => TileId = () => "grass";
  private getSelectedItem: () => string = () => "grass";
  private particleEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private destructionParticles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private isSyncing: boolean = false;
  private playerSyncEffect: Phaser.GameObjects.Graphics | null = null;
  private bgImage: Phaser.GameObjects.Image | null = null;
  private interactionCooldown: number = 0;
  private mouseDown: boolean = false;
  private mouseButton: number = 0;
  private clickProcessed: boolean = false;
  private shiftDown: boolean = false;
  private currentBiome: BiomeType = "default";
  private inventoryWithBiomes: InventoryWithBiomes = {};
  private callbacks: GameCallbacks | null = null;
  private keyboardEnabled: boolean = true; // флаг блокировки клавиатуры при фокусе на инпуте
  private dayNightOverlay: Phaser.GameObjects.Rectangle | null = null;
  private currentTimeOfDay: TimeOfDay = "day";
  private timeOfDayTransitionTween: Phaser.Tweens.Tween | null = null;

  constructor() {
    super({ key: "MainScene" });
  }

  preload() {
    // Загружаем изображения, если нужно
  }

  create() {
    // Настройка физики
    this.physics.world.bounds.setSize(MAP_W * TILE_SIZE, MAP_H * TILE_SIZE);

    // Генерация начального биома
    this.generateBiome(this.biomeSeed);

    // Создание текстур
    this.createTextures();

    // Отрисовка тайлов
    this.renderTiles();

    // Создание игрока
    this.createPlayer();

    // Настройка управления
    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.cursors = keyboard.createCursorKeys();
      this.keys = keyboard.addKeys("W,A,S,D") as { [key: string]: Phaser.Input.Keyboard.Key };
      // Добавляем клавишу F для взаимодействия с тайлом перед игроком
      this.fKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);
      // Разрешаем браузеру получать события клавиатуры когда фокус не на canvas
      keyboard.enableGlobalCapture();
    }

    // Обработка мыши
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.mouseDown = true;
      this.mouseButton = pointer.button;
      this.clickProcessed = false;
      this.handleTileInteraction(pointer);
      this.clickProcessed = true;
    });

    this.input.on("pointerup", () => {
      this.mouseDown = false;
      this.clickProcessed = false;
    });

    // Обработка клавиши Shift
    if (keyboard) {
      const shiftKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
      shiftKey.on("down", () => {
        this.shiftDown = true;
      });
      shiftKey.on("up", () => {
        this.shiftDown = false;
      });
    }

    // Камера следует за игроком
    const camera = this.cameras.main;
    camera.startFollow(this.playerGlow, true, 0.05, 0.05);
    camera.setZoom(1.2);
    camera.setBounds(0, 0, MAP_W * TILE_SIZE, MAP_H * TILE_SIZE);

    // Миникарта (упрощенная)
    this.createMinimap();

    // Оверлей для дня/ночи — растягиваем на весь мир
    this.dayNightOverlay = this.add.rectangle(
      0, 0, MAP_W * TILE_SIZE, MAP_H * TILE_SIZE,
      0x000033, 0
    ).setOrigin(0, 0).setDepth(50);

// Читаем колбэки сразу при старте сцены (до ready события)
    const earlyCallbacks = (window as any).__phaserCallbacks as GameCallbacks | undefined;
    if (earlyCallbacks) {
      this.onInventory = earlyCallbacks.onInventory;
      this.getSelectedTile = earlyCallbacks.getSelectedTile;
      this.getSelectedItem = earlyCallbacks.getSelectedItem;
      this.callbacks = earlyCallbacks;
    }

    // Слушатель сохранения мира
    window.addEventListener('phaser-save-world', () => {
      this.saveWorld();
    });

    // Блокируем/разблокируем клавиатуру когда фокус на React-инпуте
    window.addEventListener('phaser-input-focus', (event: any) => {
      const enabled = event.detail?.enabled !== false;
      this.keyboardEnabled = enabled;
      if (this.input.keyboard) {
        if (enabled) {
          this.input.keyboard.enableGlobalCapture();
        } else {
          this.input.keyboard.disableGlobalCapture();
        }
      }
      // Сбрасываем velocity чтобы игрок не залипал
      if (!enabled && this.playerBody) {
        this.playerBody.setVelocity(0, 0);
      }
    });


    // Слушатель смены биома/карты от AI (ai-patch-map)
    window.addEventListener('ai-patch-map', (event: any) => {
      const { biome, prompt } = event.detail as { biome?: string; prompt?: string };
      if (biome) {
        // Новый режим: AI прислал biome — мгновенно закрашиваем ВСЮ карту
        console.log("Phaser получил команду на смену биома:", biome);
        this.applyBiome(biome);
      } else if (prompt) {
        // Старый режим (фолбэк): точечный патч по тексту
        console.log("Phaser получил патч-команду (фолбэк):", prompt);
        this.patchMap(prompt);
      }
    });

    // Слушатель карты сгенерированной AI
    window.addEventListener('ai-map-generated', (event: any) => {
      const { biome, map } = event.detail as { biome: string; map: string[] };
      this.applyAiGeneratedMap(biome, map);
    });

    // Слушатель точечных изменений от AI (modify_area)
    window.addEventListener('ai-modify-area', (event: any) => {
      const { changes } = event.detail as { changes: Array<{x: number; y: number; tile: string}> };
      this.applyAiChanges(changes);
    });

    // Слушатель размещения объектов рядом с игроком (place_objects)
    window.addEventListener('ai-place-objects', (event: any) => {
      const { objects } = event.detail as { objects: Array<{dx: number; dy: number; tile: string}> };
      this.applyAiObjects(objects);
    });

    // Слушатель смены дня/ночи
    window.addEventListener('ai-set-time', (event: any) => {
      const { time } = event.detail as { time: TimeOfDay };
      this.setTimeOfDay(time);
    });

    // Слушатель строительства зданий
    window.addEventListener('ai-build-structure', (event: any) => {
      const { structure, x, y, width, height } = event.detail;
      this.buildStructure(structure || "постройка", x, y, width, height);
    });

    // Слушатель продвинутого терраформирования (гора, река, дорога и т.д.)
    window.addEventListener('ai-terrain', (event: any) => {
      const data = event.detail;
      this.applyTerrain(data);
    });

    // Слушатель регионального изменения
    window.addEventListener('ai-modify-region', (event: any) => {
      const { x1, y1, x2, y2, tile_from, tile_to } = event.detail;
      this.applyModifyRegion(x1, y1, x2, y2, tile_from, tile_to);
    });

    // Слушатель заполнения области
    window.addEventListener('ai-fill-area', (event: any) => {
      const { x1, y1, x2, y2, tile } = event.detail;
      this.applyFillArea(x1, y1, x2, y2, tile);
    });

    // Слушатель нанесения узора
    window.addEventListener('ai-pattern', (event: any) => {
      const { type, tile_a, tile_b, x1, y1, x2, y2 } = event.detail;
      this.applyPattern(type, tile_a || "G", tile_b || "R", x1, y1, x2, y2);
    });

    // Слушатель кастомного набора тайлов
    window.addEventListener('ai-custom-tileset', (event: any) => {
      const { tiles } = event.detail;
      this.applyCustomTileset(tiles);
    });

    // Слушатель смешивания биомов
    window.addEventListener('ai-biome-blend', (event: any) => {
      const { primary, secondary, blend_radius, center_x, center_y } = event.detail;
      this.applyBiomeBlend(primary, secondary, blend_radius, center_x, center_y);
    });

    // Автоматический цикл дня/ночи (каждые 60 секунд)
    this.time.addEvent({
      delay: 60000,
      loop: true,
      callback: () => {
        const cycle = ["day", "dusk", "night", "dawn"] as TimeOfDay[];
        const currentIdx = cycle.indexOf(this.currentTimeOfDay);
        const nextIdx = (currentIdx + 1) % cycle.length;
        this.setTimeOfDay(cycle[nextIdx]);
        // Обновляем React
        (window as any).__currentTime = cycle[nextIdx];
      },
    });

    // Слушатель принудительного сброса клавиатуры (из React)
    window.addEventListener('phaser-keyboard-reset', () => {
      this.resetKeyboard();
    });

    // Публикуем позицию игрока для game-shell
    this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => {
        if (this.player) {
          const px = Math.floor(this.player.x / TILE_SIZE);
          const py = Math.floor(this.player.y / TILE_SIZE);
          (window as any).__playerPosition = { x: px, y: py };
        }
      },
    });
  }

  private createMinimap() {
    const minimapSize = 120;
    const minimap = this.add.rectangle(
      this.cameras.main.width - minimapSize / 2 - 10,
      minimapSize / 2 + 10,
      minimapSize,
      minimapSize,
      0x000000,
      0.7
    ).setScrollFactor(0).setDepth(100);

    const minimapBorder = this.add.rectangle(
      this.cameras.main.width - minimapSize / 2 - 10,
      minimapSize / 2 + 10,
      minimapSize,
      minimapSize,
      0x000000,
      0
    ).setScrollFactor(0).setDepth(100).setStrokeStyle(2, 0xff6b35);
  }

  private createPlayer() {
    const startX = Math.floor(MAP_W / 2);
    const startY = Math.floor(MAP_H / 2);

    // Ищем ближайшую травяную клетку
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (this.tiles[y][x] === "grass") {
          const dist = Math.abs(x - startX) + Math.abs(y - startY);
          if (dist < 5) {
            this.player = this.add.sprite(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, "player-robot");
            this.player.setDepth(10);

            // Добавляем физическое тело
            this.physics.add.existing(this.player);
            this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
            this.playerBody.setCollideWorldBounds(true);
            this.playerBody.setSize(TILE_SIZE * 0.6, TILE_SIZE * 0.6);
            this.playerBody.setOffset(TILE_SIZE * 0.2, TILE_SIZE * 0.2);
            break;
          }
        }
      }
    }

    // Если игрок не был размещен (не найдено травы рядом с центром), создаем его в безопасной позиции
    if (!this.player) {
      // Находим любую травяную клетку
      for (let y = 0; y < MAP_H && !this.player; y++) {
        for (let x = 0; x < MAP_W && !this.player; x++) {
          if (this.tiles[y][x] === "grass") {
            this.player = this.add.sprite(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, "player-robot");
            this.player.setDepth(10);
            this.physics.add.existing(this.player);
            this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
            this.playerBody.setCollideWorldBounds(true);
            this.playerBody.setSize(TILE_SIZE * 0.6, TILE_SIZE * 0.6);
            this.playerBody.setOffset(TILE_SIZE * 0.2, TILE_SIZE * 0.2);
          }
        }
      }
    }

    // Если все еще нет игрока (крайний случай), создаем в центре
    if (!this.player) {
      const cx = Math.floor(MAP_W / 2);
      const cy = Math.floor(MAP_H / 2);
      this.player = this.add.sprite(cx * TILE_SIZE + TILE_SIZE / 2, cy * TILE_SIZE + TILE_SIZE / 2, "player-robot");
      this.player.setDepth(10);
      this.physics.add.existing(this.player);
      this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
      this.playerBody.setCollideWorldBounds(true);
      this.playerBody.setSize(TILE_SIZE * 0.6, TILE_SIZE * 0.6);
      this.playerBody.setOffset(TILE_SIZE * 0.2, TILE_SIZE * 0.2);
    }

    // Создаем контейнер для свечения
    this.playerGlow = this.add.container(this.player.x, this.player.y);
    this.playerGlow.setDepth(9);
    this.playerGlow.setSize(TILE_SIZE, TILE_SIZE);

    // Добавляем свечение вокруг игрока
    const glow = this.add.circle(0, 0, TILE_SIZE / 2 + 4, 0xff6b35, 0.3);
    this.playerGlow.add(glow);

    // Частицы шлейфа
    this.particleEmitter = this.add.particles(0, 0, "particle-orange", {
      speed: 20,
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.8, end: 0 },
      lifespan: 400,
      blendMode: "ADD",
      emitting: false,
    }).setDepth(8);

    // Частицы разрушения
    this.destructionParticles = this.add.particles(0, 0, "particle-debris", {
      speed: { min: 50, max: 150 },
      scale: { start: 1, end: 0.5 },
      alpha: { start: 1, end: 0 },
      lifespan: 600,
      gravityY: 200,
      emitting: false,
      blendMode: "NORMAL",
    }).setDepth(20);
  }

  update() {
    if (this.keyboardEnabled) {
      this.handleMovement();
      // Обработка клавиши F для добычи блоков перед игроком
      if (this.fKey && Phaser.Input.Keyboard.JustDown(this.fKey)) {
        this.interactWithFrontTile();
      }
    }
    this.handleTileInteractionContinuous();
    this.updateSyncEffect();
  }

  private handleMovement() {
    const speed = 150;
    let targetVx = 0;
    let targetVy = 0;

    if (this.cursors.left?.isDown || this.keys["A"]?.isDown) targetVx = -speed;
    if (this.cursors.right?.isDown || this.keys["D"]?.isDown) targetVx = speed;
    if (this.cursors.up?.isDown || this.keys["W"]?.isDown) targetVy = -speed;
    if (this.cursors.down?.isDown || this.keys["S"]?.isDown) targetVy = speed;

    if (targetVx !== 0 || targetVy !== 0) {
      // Нормализуем диагональное движение
      const magnitude = Math.sqrt(targetVx * targetVx + targetVy * targetVy);
      targetVx = (targetVx / magnitude) * speed;
      targetVy = (targetVy / magnitude) * speed;

      // Проверяем коллизии
      const predictedX = this.player.x + targetVx * 0.016;
      const predictedY = this.player.y + targetVy * 0.016;

      const canMoveX = !this.checkCollision(predictedX, this.player.y);
      const canMoveY = !this.checkCollision(this.player.x, predictedY);

      // Если движение по диагонали заблокировано, пытаемся двигаться только по одной оси
      if (!canMoveX && !canMoveY) {
        // Полностью блокируем движение
        this.playerBody.setVelocity(0, 0);
      } else if (!canMoveX) {
        // Блокируем только движение по X
        this.playerBody.setVelocity(0, targetVy);
      } else if (!canMoveY) {
        // Блокируем только движение по Y
        this.playerBody.setVelocity(targetVx, 0);
      } else {
        // Движение свободно
        this.playerBody.setVelocity(targetVx, targetVy);
      }

      // Включаем эмиттер частиц при движении
      this.particleEmitter.startFollow(this.playerGlow);
      if (!this.particleEmitter.emitting) {
        this.particleEmitter.explode(1);
      }
    } else {
      this.playerBody.setVelocity(0, 0);
      this.particleEmitter.stop();
    }

    // Анимация пульсации свечения
    const time = this.time.now / 500;
    const pulseScale = 1 + Math.sin(time) * 0.15;
    this.playerGlow.setScale(pulseScale);
    // Обновляем позицию контейнера
    this.playerGlow.x = this.player.x;
    this.playerGlow.y = this.player.y;
  }

  private checkCollision(x: number, y: number): boolean {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);

    if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return true;

    const tile = this.tiles[ty][tx];
    return tile === "water" || tile === "tree" || tile === "rock" || tile === "ruins"
      || tile === "frozen_lake" || tile === "mythic_rock" || tile === "quartz"
      || tile === "glass" || tile === "concrete" || tile === "coral";
  }

  private handleTileInteraction(pointer: Phaser.Input.Pointer) {
    const worldX = pointer.x + this.cameras.main.scrollX;
    const worldY = pointer.y + this.cameras.main.scrollY;

    const tx = Math.floor(worldX / TILE_SIZE);
    const ty = Math.floor(worldY / TILE_SIZE);

    if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return;

    const tile = this.tiles[ty][tx];

    // Проверяем расстояние до игрока (нельзя взаимодействовать слишком далеко)
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, worldX, worldY);
    if (dist > TILE_SIZE * 3) return;

    if (this.shiftDown || this.mouseButton === 1) {
      // Shift+ЛКМ или ПКМ - поставить тайл
      this.placeTile(tx, ty);
    } else {
      // ЛКМ - сломать тайл
      // Игнорируем tint - проверяем только базовый тип тайла
      // Вода и пустые тайлы не ломаются
      const notBreakable: TileId[] = ["empty", "water", "frozen_lake"];
      if (!notBreakable.includes(tile)) {
        this.breakTileWithEffect(tx, ty, tile);
      }
    }
  }

  private handleTileInteractionContinuous() {
    // Отключаем непрерывную обработку для предотвращения множественного списания блоков
    // Обработка происходит только в событии pointerdown
    return;
  }

  // Обновление эффекта синхронизации (визуальный индикатор генерации)
  // Called from update loop
  private updateSyncEffect() {
    if (this.isSyncing) {
      if (!this.playerSyncEffect) {
        this.playerSyncEffect = this.add.graphics();
        this.playerSyncEffect.setDepth(13);
      }
      
      const time = this.time.now / 300;
      const radius = 20 + Math.sin(time) * 5;
      const alpha = 0.3 + Math.sin(time) * 0.2;
      
      this.playerSyncEffect.clear();
      this.playerSyncEffect.lineStyle(2, 0x00BFFF, alpha);
      this.playerSyncEffect.strokeCircle(0, 0, radius);
      this.playerSyncEffect.fillStyle(0x00BFFF, alpha * 0.3);
      this.playerSyncEffect.fillCircle(0, 0, radius);
    } else {
      if (this.playerSyncEffect) {
        this.playerSyncEffect.destroy();
        this.playerSyncEffect = null;
      }
    }
  }

  // Установка режима синхронизации
  public setSyncing(syncing: boolean) {
    this.isSyncing = syncing;
  }

  public applyAiBiomeBackground(imageUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Включаем режим синхронизации (визуальный эффект)
      this.setSyncing(true);
      
      const key = `biome-bg-${Date.now()}`;
      
      // Используем нативный HTML Image для загрузки (работает надежнее чем Phaser loader)
      const img = new window.Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        // 1. Добавляем загруженную HTML картинку в кэш текстур Phaser
        if (!this.textures.exists(key)) {
          this.textures.addImage(key, img);
        }

        // 2. Применяем текстуру фона
        this.bgImage?.destroy();
        const w = MAP_W * TILE_SIZE;
        const h = MAP_H * TILE_SIZE;
        
        this.bgImage = this.add.image(0, 0, key)
          .setOrigin(0, 0)
          .setDepth(-30)
          .setDisplaySize(w, h);
        
        // Плавное появление фона
        this.bgImage.setAlpha(0);
        this.tweens.add({
          targets: this.bgImage,
          alpha: 1,
          duration: 1000,
          onComplete: () => {
            this.setSyncing(false);
            resolve();
          },
        });
      };

      img.onerror = () => {
        console.error("Нативная ошибка загрузки изображения браузером:", imageUrl);
        this.setSyncing(false);
        reject(new Error("Не удалось загрузить фон биома через HTML Image"));
      };

      // Запускаем загрузку
      img.src = imageUrl;
    });
  }

  public regenerateProceduralMap() {
    this.biomeSeed = Math.floor(Math.random() * 1_000_000);
    this.rng = mulberry32(this.biomeSeed);
    this.inventory = {};
    this.emitInventory();
    this.generateBiome(this.biomeSeed);
    this.renderTiles(true);
    
    // Перемещаем игрока на новую травяную клетку
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (this.tiles[y][x] === "grass") {
          this.playerGlow.setPosition(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
          this.playerBody.reset(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
          this.cameras.main.startFollow(this.playerGlow, true, 0.05, 0.05);
          return;
        }
      }
    }
  }

  public saveWorld() {
    // Сохраняем данные мира в JSON
    const worldData = this.exportWorldData();
    console.log("Сохранение мира:", worldData);
    
    // Визуальный эффект сохранения
    this.cameras.main.flash(200, 255, 107, 65);
    
    // Возвращаем данные для внешней обработки
    return worldData;
  }

  // Экспорт данных мира для сохранения
  public exportWorldData() {
    const tilesData = [];
    
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const idx = y * MAP_W + x;
        const tile = this.tiles[y][x];
        const sprite = this.tileSprites[idx];
        
        if (sprite) {
          tilesData.push({
            x,
            y,
            tile,
            texture: sprite.texture.key,
            tint: sprite.tint,
            scale: sprite.scale,
            biome: sprite.getData('biome') || 'default',
            type: sprite.getData('type') || 'default',
            alpha: sprite.alpha
          });
        }
      }
    }

    return {
      version: 2,
      biomeSeed: this.biomeSeed,
      currentBiome: this.currentBiome,
      tiles: tilesData,
      inventory: this.inventory,
      inventoryWithBiomes: this.inventoryWithBiomes,
      timestamp: Date.now()
    };
  }

  // Импорт данных мира из JSON
  public importWorldData(data: any) {
    try {
      // Очищаем текущий мир
      this.tileSprites.forEach(s => s?.destroy());
      this.tileSprites = [];
      
      // Восстанавливаем биом
      if (data.currentBiome) {
        this.currentBiome = data.currentBiome;
      }
      
      // Восстанавливаем инвентарь
      if (data.inventory) {
        this.inventory = data.inventory;
      }
      if (data.inventoryWithBiomes) {
        this.inventoryWithBiomes = data.inventoryWithBiomes;
      }
      
      // Восстанавливаем тайлы
      for (const tileData of data.tiles) {
        const { x, y, tile, texture, tint, scale, biome, type, alpha } = tileData;
        const idx = y * MAP_W + x;
        
        // Обновляем данные тайла
        this.tiles[y][x] = tile;
        
        // Создаем спрайт
        const px = x * TILE_SIZE + TILE_SIZE / 2;
        const py = y * TILE_SIZE + TILE_SIZE / 2;
        const img = this.add.image(px, py, texture);
        img.setDepth(5);
        img.setOrigin(0.5);
        img.setAlpha(alpha || this.tileAlpha(tile));
        
        // Восстанавливаем tint и scale
        if (tint !== undefined && tint !== null) {
          img.setTint(tint);
        }
        if (scale !== undefined && scale !== null) {
          img.setScale(scale);
        }
        
        // Восстанавливаем данные биома
        img.setData('biome', biome || 'default');
        img.setData('type', type || 'default');
        
        this.tileSprites[idx] = img;
      }
      
      this.emitInventory();
      console.log("Мир успешно загружен!");
      return true;
    } catch (error) {
      console.error("Ошибка при загрузке мира:", error);
      return false;
    }
  }

  // Умная генерация биома с использованием шума и клеточных автоматов
  // Создаем организованный ландшафт: поляны в центре, леса по бокам, озера
  private generateBiome(seed: number) {
    const r = mulberry32(seed);
    const elevationSeed = r() * 1000;
    const moistureSeed = r() * 1000 + 500;
    
    // Генерируем базовую карту высот и влажности
    const elevation: number[][] = [];
    const moisture: number[][] = [];
    
    for (let y = 0; y < MAP_H; y++) {
      elevation[y] = [];
      moisture[y] = [];
      for (let x = 0; x < MAP_W; x++) {
        // Базовый шум с несколькими октавами
        elevation[y][x] = fbm(x, y, elevationSeed, 4);
        moisture[y][x] = fbm(x + 100, y + 100, moistureSeed, 3);
        
        // Влияние расстояния от центра для создания острова
        const dx = (x - MAP_W / 2) / (MAP_W / 2);
        const dy = (y - MAP_H / 2) / (MAP_H / 2);
        const distFromCenter = Math.sqrt(dx * dx + dy * dy);
        
        // Чем дальше от центра, тем ниже высота (создаем остров)
        elevation[y][x] = elevation[y][x] * (1 - distFromCenter * 0.6) + r() * 0.15;
      }
    }
    
    // Применяем клеточный автомат для сглаживания и создания кластеров
    const smoothElevation = elevation.map(row => [...row]);
    const smoothMoisture = moisture.map(row => [...row]);
    
    for (let iteration = 0; iteration < 4; iteration++) {
      for (let y = 1; y < MAP_H - 1; y++) {
        for (let x = 1; x < MAP_W - 1; x++) {
          let eSum = 0, mSum = 0, count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              eSum += elevation[y + dy][x + dx];
              mSum += moisture[y + dy][x + dx];
              count++;
            }
          }
          smoothElevation[y][x] = eSum / count;
          smoothMoisture[y][x] = mSum / count;
        }
      }
    }
    
    // Генерируем тайлы на основе сглаженных значений
    this.tiles = Array.from({ length: MAP_H }, (_, y) =>
      Array.from({ length: MAP_W }, (_, x) => {
        const e = smoothElevation[y][x];
        const m = smoothMoisture[y][x];
        
        // Определяем тип тайла на основе высоты и влажности
        if (e < 0.28) return "water";           // Низкие участки - вода
        if (e < 0.33 && m > 0.5) return "water"; // Влажные низины - тоже вода
        if (e < 0.40) return "rock";            // Скалистые участки
        if (m > 0.55 && e < 0.60) return "tree"; // Влажные участки - лес
        if (e > 0.80 && r() > 0.7) return "ruins"; // Очень высокие участки - руины
        return "grass";                          // Остальное - трава
      })
    );
    
    // Создаем центральную поляну (большую открытую область)
    this.createCentralMeadow(r);
    
    // Создаем организованные леса по бокам карты
    this.createOrganizedForests(r);
    
    // Создаем cohesive озера (группы озер)
    this.createOrganizedLakes(r);
    
    // Добавляем тропинки (извилистые дорожки из травы)
    this.createPaths(r, smoothElevation);
    
    // Добавляем кластеры камней у воды
    this.addRockClusters(r, smoothElevation);
  }
  
  // Создание центральной поляны
  private createCentralMeadow(r: () => number) {
    const centerX = MAP_W / 2 + (r() - 0.5) * 10;
    const centerY = MAP_H / 2 + (r() - 0.5) * 10;
    const meadowRadius = 8 + Math.floor(r() * 6); // 8-14 тайлов радиус
    
    for (let dy = -meadowRadius; dy <= meadowRadius; dy++) {
      for (let dx = -meadowRadius; dx <= meadowRadius; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= meadowRadius) {
          const mx = Math.floor(centerX + dx);
          const my = Math.floor(centerY + dy);
          if (mx >= 2 && mx < MAP_W - 2 && my >= 2 && my < MAP_H - 2) {
            // Делаем поляну с неровными краями
            if (dist < meadowRadius - 1 || r() > 0.3) {
              this.tiles[my][mx] = "grass";
            }
          }
        }
      }
    }
    
    // Гарантируем траву в центре для спавна игрока
    const cx = Math.floor(centerX);
    const cy = Math.floor(centerY);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const mx = cx + dx;
        const my = cy + dy;
        if (mx >= 0 && mx < MAP_W && my >= 0 && my < MAP_H) {
          this.tiles[my][mx] = "grass";
        }
      }
    }
  }
  
  // Создание организованных лесов по бокам
  private createOrganizedForests(r: () => number) {
    // Левый лес
    this.createForestRegion(r, 2, 5, 12, MAP_H - 10, 0.6);
    // Правый лес
    this.createForestRegion(r, MAP_W - 14, 5, 12, MAP_H - 10, 0.6);
    // Верхний лес (опционально)
    if (r() > 0.5) {
      this.createForestRegion(r, 10, 2, MAP_W - 20, 10, 0.4);
    }
    // Нижний лес (опционально)
    if (r() > 0.5) {
      this.createForestRegion(r, 10, MAP_H - 12, MAP_W - 20, 10, 0.4);
    }
  }
  
  private createForestRegion(r: () => number, startX: number, startY: number, width: number, height: number, density: number) {
    for (let y = startY; y < startY + height && y < MAP_H; y++) {
      for (let x = startX; x < startX + width && x < MAP_W; x++) {
        if (this.tiles[y][x] !== "water" && r() < density) {
          this.tiles[y][x] = "tree";
        }
      }
    }
    
    // Добавляем небольшие поляны внутри леса
    const numClearings = 2 + Math.floor(r() * 3);
    for (let c = 0; c < numClearings; c++) {
      const cx = startX + Math.floor(r() * width);
      const cy = startY + Math.floor(r() * height);
      const clearingRadius = 2 + Math.floor(r() * 2);
      
      for (let dy = -clearingRadius; dy <= clearingRadius; dy++) {
        for (let dx = -clearingRadius; dx <= clearingRadius; dx++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= clearingRadius) {
            const mx = cx + dx;
            const my = cy + dy;
            if (mx >= 0 && mx < MAP_W && my >= 0 && my < MAP_H) {
              if (r() > 0.3) { // Неровные края
                this.tiles[my][mx] = "grass";
              }
            }
          }
        }
      }
    }
  }
  
  // Создание организованных озер
  private createOrganizedLakes(r: () => number) {
    // Определяем 2-3 места для озер (обычно у краев или в низинах)
    const numLakes = 2 + Math.floor(r() * 2);
    
    for (let l = 0; l < numLakes; l++) {
      // Выбираем место для озера (предпочитаем края и низкие участки)
      let lx: number, ly: number;
      
      if (r() > 0.6) {
        // Озеро у края карты
        const edge = Math.floor(r() * 4);
        if (edge === 0) { lx = Math.floor(r() * 15); ly = Math.floor(r() * MAP_H); }
        else if (edge === 1) { lx = MAP_W - Math.floor(r() * 15) - 1; ly = Math.floor(r() * MAP_H); }
        else if (edge === 2) { lx = Math.floor(r() * MAP_W); ly = Math.floor(r() * 15); }
        else { lx = Math.floor(r() * MAP_W); ly = MAP_H - Math.floor(r() * 15) - 1; }
      } else {
        // Озеро в случайном месте
        lx = Math.floor(r() * MAP_W);
        ly = Math.floor(r() * MAP_H);
      }
      
      const lakeSize = 4 + Math.floor(r() * 6); // 4-10 тайлов радиус
      
      for (let dy = -lakeSize; dy <= lakeSize; dy++) {
        for (let dx = -lakeSize; dx <= lakeSize; dx++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          // Неровные края озера
          const noise = r() * 2;
          if (dist + noise <= lakeSize) {
            const mx = lx + dx;
            const my = ly + dy;
            if (mx >= 1 && mx < MAP_W - 1 && my >= 1 && my < MAP_H - 1) {
              this.tiles[my][mx] = "water";
            }
          }
        }
      }
    }
  }
  
  // Создание извилистых тропинок
  private createPaths(r: () => number, elevation: number[][]) {
    const numPaths = 3 + Math.floor(r() * 3); // 3-5 тропинок
    
    for (let p = 0; p < numPaths; p++) {
      // Начинаем с случайной травяной клетки
      let x = Math.floor(r() * MAP_W);
      let y = Math.floor(r() * MAP_H);
      
      // Находим ближайшую травяную клетку
      for (let attempt = 0; attempt < 20 && this.tiles[y][x] !== "grass"; attempt++) {
        x = Math.floor(r() * MAP_W);
        y = Math.floor(r() * MAP_H);
      }
      
      if (this.tiles[y][x] !== "grass") continue;
      
      // Прокладываем извилистую тропинку
      const pathLength = 20 + Math.floor(r() * 30);
      let px = x, py = y;
      
      for (let i = 0; i < pathLength; i++) {
        // Случайное направление с предпочтением прямо
        const direction = r();
        let dx = 0, dy = 0;
        
        if (direction < 0.4) dx = 1;
        else if (direction < 0.6) dx = -1;
        else if (direction < 0.8) dy = 1;
        else dy = -1;
        
        px = Math.max(1, Math.min(MAP_W - 2, px + dx));
        py = Math.max(1, Math.min(MAP_H - 2, py + dy));
        
        // Превращаем в траву (если это не вода)
        if (this.tiles[py][px] !== "water") {
          this.tiles[py][px] = "grass";
        }
        
        // Иногда расширяем тропинку
        if (r() > 0.6) {
          const nx = Math.max(1, Math.min(MAP_W - 2, px + (dy !== 0 ? 1 : 0)));
          const ny = Math.max(1, Math.min(MAP_H - 2, py + (dx !== 0 ? 1 : 0)));
          if (this.tiles[ny][nx] !== "water") {
            this.tiles[ny][nx] = "grass";
          }
        }
      }
    }
  }
  
  // Добавление кластеров деревьев
  private addTreeClusters(r: () => number, elevation: number[][]) {
    const numClusters = 5 + Math.floor(r() * 5); // 5-10 кластеров
    
    for (let c = 0; c < numClusters; c++) {
      // Выбираем место у края карты или у воды
      let cx = Math.floor(r() * MAP_W);
      let cy = Math.floor(r() * MAP_H);
      
      // Смещаем к краям
      if (r() > 0.5) {
        if (r() > 0.5) cx = Math.floor(r() * (MAP_W / 3));
        else cx = MAP_W - Math.floor(r() * (MAP_W / 3)) - 1;
      }
      if (r() > 0.5) {
        if (r() > 0.5) cy = Math.floor(r() * (MAP_H / 3));
        else cy = MAP_H - Math.floor(r() * (MAP_H / 3)) - 1;
      }
      
      // Размер кластера
      const clusterSize = 3 + Math.floor(r() * 5);
      
      for (let i = 0; i < clusterSize; i++) {
        const tx = cx + Math.floor(r() * 7) - 3;
        const ty = cy + Math.floor(r() * 7) - 3;
        
        if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) {
          if (this.tiles[ty][tx] === "grass") {
            this.tiles[ty][tx] = "tree";
          }
        }
      }
    }
  }
  
  // Добавление кластеров камней
  private addRockClusters(r: () => number, elevation: number[][]) {
    const numClusters = 3 + Math.floor(r() * 4); // 3-6 кластеров
    
    for (let c = 0; c < numClusters; c++) {
      // Ищем место у воды
      let cx = Math.floor(r() * MAP_W);
      let cy = Math.floor(r() * MAP_H);
      
      // Пытаемся найти место рядом с водой
      for (let attempt = 0; attempt < 10; attempt++) {
        let nearWater = false;
        for (let dy = -2; dy <= 2 && !nearWater; dy++) {
          for (let dx = -2; dx <= 2 && !nearWater; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H) {
              if (this.tiles[ny][nx] === "water") {
                nearWater = true;
              }
            }
          }
        }
        if (nearWater) break;
        cx = Math.floor(r() * MAP_W);
        cy = Math.floor(r() * MAP_H);
      }
      
      // Размер кластера (2-4 камня)
      const clusterSize = 2 + Math.floor(r() * 3);
      
      for (let i = 0; i < clusterSize; i++) {
        const rx = cx + Math.floor(r() * 5) - 2;
        const ry = cy + Math.floor(r() * 5) - 2;
        
        if (rx >= 0 && rx < MAP_W && ry >= 0 && ry < MAP_H) {
          if (this.tiles[ry][rx] === "grass") {
            this.tiles[ry][rx] = "rock";
          }
        }
      }
    }
  }

  private createTextures() {
    // Улучшенная функция создания тайлов с рамкой
    const makeTile = (key: string, color: number, deco?: (g: Phaser.GameObjects.Graphics) => void) => {
      const g = this.add.graphics();
      g.fillStyle(color, 1);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      if (deco) deco(g);
      // Добавляем тонкую темную рамку
      g.lineStyle(1, 0x0a0a0a, 0.4);
      g.strokeRect(0, 0, TILE_SIZE, TILE_SIZE);
      g.generateTexture(key, TILE_SIZE, TILE_SIZE);
      g.destroy();
    };

    // Глубокий изумрудный для травы с текстурой
    makeTile("tile-grass", 0x0d7346, (g) => {
      // Добавляем текстуру травы
      g.fillStyle(0x0a5c38, 0.6);
      for (let i = 0; i < 12; i++) {
        const x = Math.random() * 28 + 2;
        const y = Math.random() * 28 + 2;
        g.fillRect(x, y, 2, 4);
      }
      // Светлые пятна
      g.fillStyle(0x1a9e5e, 0.3);
      for (let i = 0; i < 6; i++) {
        g.fillCircle(Math.random() * 28 + 2, Math.random() * 28 + 2, 2);
      }
    });

    // Глубокий синий для воды с прозрачностью и волнами
    makeTile("tile-water", 0x0a3d62, (g) => {
      g.fillStyle(0x0a3d62, 0.5); // Полупрозрачный слой
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      // Волны
      g.fillStyle(0x1a6b9e, 0.4);
      for (let i = 0; i < 3; i++) {
        const y = 8 + i * 8;
        g.fillRect(2, y, 12, 2);
        g.fillRect(18, y + 4, 10, 2);
      }
    });

    // Темно-серый для скал с текстурой
    makeTile("tile-rock", 0x2d3436, (g) => {
      // Текстура камня
      g.fillStyle(0x3d4648, 0.7);
      for (let i = 0; i < 8; i++) {
        const x = Math.random() * 24 + 4;
        const y = Math.random() * 24 + 4;
        g.fillCircle(x, y, Math.random() * 3 + 2);
      }
      // Трещины
      g.lineStyle(1, 0x1a1e20, 0.5);
      for (let i = 0; i < 3; i++) {
        g.lineBetween(
          Math.random() * 28 + 2, Math.random() * 28 + 2,
          Math.random() * 28 + 2, Math.random() * 28 + 2
        );
      }
    });

    // Дерево в виде стилизованной елки (два треугольника)
    makeTile("tile-tree", 0x0d7346, (g) => {
      // Тень под деревом
      g.fillStyle(0x0a0a0a, 0.3);
      g.fillEllipse(16, 28, 16, 8);
      // Ствол
      g.fillStyle(0x5d4037, 1);
      g.fillRect(13, 20, 6, 10);
      // Нижняя крона (треугольник)
      g.fillStyle(0x1b5e20, 1);
      g.fillTriangle(16, 4, 4, 22, 28, 22);
      // Верхняя крона (треугольник)
      g.fillStyle(0x2e7d32, 1);
      g.fillTriangle(16, 2, 8, 16, 24, 16);
    });

    // Руины
    makeTile("tile-ruins", 0x2d3436, (g) => {
      // Основание
      g.fillStyle(0x4a5568, 1);
      g.fillRect(6, 14, 20, 14);
      // Колонны
      g.fillStyle(0x5a6578, 1);
      g.fillRect(8, 8, 4, 8);
      g.fillRect(20, 10, 4, 6);
      // Обломки
      g.fillStyle(0x3d4648, 0.8);
      g.fillCircle(12, 24, 3);
      g.fillCircle(22, 26, 2);
    });

    // ==========================================
    // РОБОТ-ЧЕЛОВЕЧЕК (вместо простого круга)
    // ==========================================
    const robot = this.add.graphics();
    
    // Внешнее свечение (оранжевое)
    robot.fillStyle(0xff6b35, 0.2);
    robot.fillCircle(16, 16, 16);
    
    // Среднее свечение
    robot.fillStyle(0xff6b35, 0.4);
    robot.fillCircle(16, 16, 12);
    
    // --- ТЕЛО (скругленный прямоугольник) ---
    robot.fillStyle(0xff8c42, 1);
    robot.fillRoundedRect(10, 18, 12, 14, 3);
    
    // Контур тела
    robot.lineStyle(1, 0xff6b35, 0.5);
    robot.strokeRoundedRect(10, 18, 12, 14, 3);
    
    // --- ГОЛОВА (овал) ---
    robot.fillStyle(0xff9f5a, 1);
    robot.fillEllipse(16, 10, 12, 10);
    
    // Контур головы
    robot.lineStyle(1, 0xff6b35, 0.5);
    robot.strokeEllipse(16, 10, 12, 10);
    
    // --- ГЛАЗА (светящиеся синие) ---
    robot.fillStyle(0x00BFFF, 0.9);
    robot.fillCircle(13, 9, 2.5);
    robot.fillCircle(19, 9, 2.5);
    
    // Яркий центр глаз
    robot.fillStyle(0xffffff, 1);
    robot.fillCircle(13, 9, 1);
    robot.fillCircle(19, 9, 1);
    
    // --- АНТЕННА (указатель направления) ---
    robot.fillStyle(0xff6b35, 1);
    robot.fillRect(15, 2, 2, 6);
    robot.fillStyle(0x00BFFF, 1);
    robot.fillCircle(16, 2, 2.5);
    
    // --- РУКИ ---
    robot.fillStyle(0xff8c42, 1);
    robot.fillRoundedRect(6, 20, 4, 8, 2);
    robot.fillRoundedRect(22, 20, 4, 8, 2);
    
    // --- НОГИ ---
    robot.fillStyle(0xe07a3a, 1);
    robot.fillRoundedRect(11, 32, 4, 6, 2);
    robot.fillRoundedRect(17, 32, 4, 6, 2);
    
    // --- СИНИЙ АКЦЕНТ В ЦЕНТРЕ ТЕЛА ---
    robot.fillStyle(0x00BFFF, 0.6);
    robot.fillCircle(16, 25, 3);
    robot.fillStyle(0xffffff, 0.4);
    robot.fillCircle(16, 25, 1.5);
    
    robot.generateTexture("player-robot", TILE_SIZE, TILE_SIZE);
    robot.destroy();

    // Частица для эмиттера шлейфа
    const particle = this.add.graphics();
    particle.fillStyle(0xff6b35, 1);
    particle.fillCircle(2, 2, 2);
    particle.generateTexture("particle-orange", 4, 4);
    particle.destroy();

    // Частицы для разрушения (разноцветные обломки)
    const debrisParticle = this.add.graphics();
    debrisParticle.fillStyle(0x8B7373, 0.55);
    debrisParticle.fillRect(0, 0, 4, 4);
    debrisParticle.generateTexture("particle-debris", 4, 4);
    debrisParticle.destroy();

    // ==========================================
    // ТЕКСТУРЫ ДЛЯ ТЕРРАФОРМИРОВАНИЯ
    // ==========================================

    // Песок (для пустынного биома)
    makeTile("tile-sand", 0xedc9af, (g) => {
      // Текстура песка
      g.fillStyle(0xd4b896, 0.5);
      for (let i = 0; i < 15; i++) {
        const x = Math.random() * 28 + 2;
        const y = Math.random() * 28 + 2;
        g.fillCircle(x, y, Math.random() * 2 + 1);
      }
    });

    // Снег (для снежного биома)
    makeTile("tile-snow", 0xf0f4f8, (g) => {
      // Текстура снега
      g.fillStyle(0xdde5ed, 0.4);
      for (let i = 0; i < 10; i++) {
        const x = Math.random() * 28 + 2;
        const y = Math.random() * 28 + 2;
        g.fillCircle(x, y, Math.random() * 3 + 1);
      }
    });

    // Вулканический камень (для лавового биома)
    makeTile("tile-volcanic", 0x2a1a1a, (g) => {
      // Текстура вулканического камня
      g.fillStyle(0x3d2a2a, 0.6);
      for (let i = 0; i < 8; i++) {
        const x = Math.random() * 24 + 4;
        const y = Math.random() * 24 + 4;
        g.fillCircle(x, y, Math.random() * 3 + 2);
      }
      // Трещины с лавой
      g.lineStyle(2, 0xff4400, 0.5);
      for (let i = 0; i < 3; i++) {
        g.lineBetween(
          Math.random() * 28 + 2, Math.random() * 28 + 2,
          Math.random() * 28 + 2, Math.random() * 28 + 2
        );
      }
    });

    // Кактус (для пустынного биома)
    const cactus = this.add.graphics();
    cactus.fillStyle(0x2d5a27, 1);
    cactus.fillRect(14, 10, 4, 18);
    cactus.fillStyle(0x3d7a37, 1);
    cactus.fillRect(8, 14, 6, 4);
    cactus.fillRect(18, 12, 6, 4);
    cactus.fillRect(6, 10, 4, 4);
    cactus.fillRect(22, 8, 4, 4);
    cactus.generateTexture("tile-cactus", TILE_SIZE, TILE_SIZE);
    cactus.destroy();

    // Заснеженная ель (для снежного биома)
    const snowTree = this.add.graphics();
    snowTree.fillStyle(0x0a0a0a, 0.3);
    snowTree.fillEllipse(16, 28, 16, 8);
    snowTree.fillStyle(0x5d4037, 1);
    snowTree.fillRect(13, 20, 6, 10);
    snowTree.fillStyle(0x4a7a5a, 1);
    snowTree.fillTriangle(16, 2, 2, 24, 30, 24);
    snowTree.fillStyle(0x6a9a7a, 1);
    snowTree.fillTriangle(16, 0, 6, 18, 26, 18);
    snowTree.fillStyle(0xffffff, 0.6);
    snowTree.fillTriangle(16, 0, 10, 12, 22, 12);
    snowTree.fillTriangle(16, 4, 8, 16, 24, 16);
    snowTree.generateTexture("tile-pine-snow", TILE_SIZE, TILE_SIZE);
    snowTree.destroy();

    // Остатки магмы (для лавового биома)
    const magmaResidue = this.add.graphics();
    magmaResidue.fillStyle(0x1a0a0a, 1);
    magmaResidue.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    magmaResidue.fillStyle(0xff4400, 0.8);
    for (let i = 0; i < 5; i++) {
      magmaResidue.fillCircle(Math.random() * 28 + 2, Math.random() * 28 + 2, Math.random() * 3 + 2);
    }
    magmaResidue.fillStyle(0xff6600, 0.5);
    for (let i = 0; i < 8; i++) {
      magmaResidue.fillCircle(Math.random() * 28 + 2, Math.random() * 28 + 2, Math.random() * 2 + 1);
    }
    magmaResidue.generateTexture("tile-magma", TILE_SIZE, TILE_SIZE);
    magmaResidue.destroy();

    // Гриб (для болотного биома)
    const mushroom = this.add.graphics();
    mushroom.fillStyle(0x3a2a4a, 1); // тёмная земля
    mushroom.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    mushroom.fillStyle(0xffffff, 0.3); // споры
    for (let i = 0; i < 6; i++) {
      mushroom.fillCircle(Math.random() * 28 + 2, Math.random() * 28 + 2, Math.random() * 2 + 1);
    }
    mushroom.fillStyle(0x8b1a1a, 1); // шляпка
    mushroom.fillEllipse(16, 10, 22, 14);
    mushroom.fillStyle(0xcc2222, 1);
    mushroom.fillEllipse(16, 8, 18, 10);
    mushroom.fillStyle(0xffffff, 0.8); // пятна на шляпке
    mushroom.fillCircle(12, 7, 2); mushroom.fillCircle(20, 9, 1.5); mushroom.fillCircle(16, 5, 1);
    mushroom.fillStyle(0xf5deb3, 1); // ножка
    mushroom.fillRect(13, 14, 6, 14);
    mushroom.generateTexture("tile-mushroom", TILE_SIZE, TILE_SIZE);
    mushroom.destroy();

    // Кристалл (для подземного/снежного биома)
    const crystal = this.add.graphics();
    crystal.fillStyle(0x0a0a2a, 1); // тёмный фон
    crystal.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    crystal.fillStyle(0x44aaff, 0.8); // кристалл
    crystal.fillTriangle(16, 2, 8, 20, 24, 20);
    crystal.fillStyle(0x66ccff, 0.9);
    crystal.fillTriangle(16, 4, 10, 18, 22, 18);
    crystal.fillStyle(0xaaddff, 0.6); // блик
    crystal.fillTriangle(16, 5, 14, 12, 19, 12);
    crystal.fillStyle(0x33aaff, 0.7); // основание
    crystal.fillTriangle(8, 20, 24, 20, 16, 30);
    crystal.generateTexture("tile-crystal", TILE_SIZE, TILE_SIZE);
    crystal.destroy();

    // Болото (тёмная вода)
    makeTile("tile-bog", 0x1e3a1e, (g) => {
      g.fillStyle(0x2d5a2d, 0.5);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      g.fillStyle(0x3d7a3d, 0.3);
      for (let i = 0; i < 4; i++) {
        g.fillCircle(Math.random() * 28 + 2, Math.random() * 28 + 2, Math.random() * 4 + 2);
      }
    });

    // ==========================================
    // НОВЫЕ ОБЪЕКТЫ
    // ==========================================

    // ЛЁД — полупрозрачный голубой
    makeTile("tile-ice", 0x99ddff, (g) => {
      g.fillStyle(0xbbeeFF, 0.5);
      g.fillRect(2, 2, 28, 28);
      g.lineStyle(1, 0xffffff, 0.6);
      g.lineBetween(4, 10, 28, 10);
      g.lineBetween(4, 20, 28, 20);
      g.fillStyle(0xffffff, 0.25);
      g.fillTriangle(4, 4, 14, 4, 4, 14);
      g.fillTriangle(18, 18, 28, 28, 18, 28);
    });

    // МИФИЧЕСКАЯ ТРАВА — розово-фиолетовая светящаяся
    makeTile("tile-mythic-grass", 0x8833aa, (g) => {
      g.fillStyle(0x9944bb, 0.7);
      for (let i = 0; i < 10; i++) {
        g.fillRect(Math.random()*26+2, Math.random()*26+2, 2, 5);
      }
      g.fillStyle(0xff66ff, 0.3);
      for (let i = 0; i < 5; i++) {
        g.fillCircle(Math.random()*28+2, Math.random()*28+2, 2.5);
      }
      g.fillStyle(0xffaaff, 0.15);
      g.fillCircle(16, 16, 10);
    });

    // МИФИЧЕСКИЙ КАМЕНЬ — тёмно-фиолетовый с кристаллическими вкраплениями
    makeTile("tile-mythic-rock", 0x3a1a55, (g) => {
      g.fillStyle(0x4a2a66, 0.8);
      for (let i = 0; i < 7; i++) {
        g.fillCircle(Math.random()*24+4, Math.random()*24+4, Math.random()*3+2);
      }
      g.fillStyle(0xcc44ff, 0.6);
      g.fillTriangle(8, 20, 14, 8, 20, 20);
      g.fillStyle(0xaa22ee, 0.4);
      g.fillTriangle(16, 22, 24, 12, 28, 22);
      g.lineStyle(1, 0xff88ff, 0.5);
      g.lineBetween(8, 20, 14, 8);
      g.lineBetween(16, 22, 24, 12);
    });

    // СНЕЖНЫЙ КОМОК — белый шар
    const snowball = this.add.graphics();
    snowball.fillStyle(0xffffff, 1);
    snowball.fillCircle(16, 18, 11);
    snowball.fillStyle(0xddeeff, 0.5);
    snowball.fillCircle(11, 14, 5);
    snowball.lineStyle(1, 0xaaccee, 0.4);
    snowball.strokeCircle(16, 18, 11);
    snowball.generateTexture("tile-snowball", TILE_SIZE, TILE_SIZE);
    snowball.destroy();

    // ЗАМЁРЗШЕЕ ОЗЕРО — светло-голубой непрозрачный с трещинами
    makeTile("tile-frozen-lake", 0x88ccff, (g) => {
      g.fillStyle(0xaaddff, 0.4);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      g.lineStyle(1, 0xffffff, 0.5);
      g.lineBetween(4, 8, 16, 14);
      g.lineBetween(16, 14, 28, 6);
      g.lineBetween(8, 20, 20, 26);
      g.fillStyle(0xffffff, 0.2);
      g.fillEllipse(16, 16, 20, 10);
    });

    // КВАРЦ — белый с радужным отливом
    const quartz = this.add.graphics();
    quartz.fillStyle(0xfff0f8, 1);
    quartz.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    quartz.fillStyle(0xffe0f0, 0.5);
    quartz.fillTriangle(16, 2, 6, 18, 26, 18);
    quartz.fillStyle(0xffffff, 0.8);
    quartz.fillTriangle(16, 4, 10, 14, 22, 14);
    quartz.fillStyle(0xffccee, 0.6);
    quartz.fillTriangle(6, 18, 26, 18, 16, 30);
    quartz.lineStyle(1, 0xffaadd, 0.8);
    quartz.lineBetween(6, 18, 16, 2);
    quartz.lineBetween(16, 2, 26, 18);
    quartz.generateTexture("tile-quartz", TILE_SIZE, TILE_SIZE);
    quartz.destroy();

    // ДОСКА — деревянные планки
    makeTile("tile-board", 0x8b5e3c, (g) => {
      g.fillStyle(0xa06840, 1);
      for (let i = 0; i < 4; i++) {
        g.fillRect(0, i * 8, TILE_SIZE, 7);
        g.lineStyle(1, 0x5a3820, 0.5);
        g.lineBetween(0, i*8+7, TILE_SIZE, i*8+7);
        // волокна
        g.lineStyle(1, 0x7a4a28, 0.25);
        g.lineBetween(Math.random()*30, i*8+1, Math.random()*30, i*8+6);
      }
    });

    // СТЕКЛО — прозрачный с отражением
    makeTile("tile-glass", 0xaaddff, (g) => {
      g.fillStyle(0xcceeFF, 0.3);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      g.fillStyle(0xffffff, 0.5);
      g.fillTriangle(2, 2, 14, 2, 2, 14);
      g.fillStyle(0xffffff, 0.2);
      g.fillTriangle(18, 2, 30, 2, 30, 14);
      g.lineStyle(1, 0x88bbee, 0.8);
      g.strokeRect(1, 1, TILE_SIZE-2, TILE_SIZE-2);
      g.lineStyle(1, 0xaaccff, 0.4);
      g.lineBetween(0, 0, TILE_SIZE, TILE_SIZE);
    });

    // БЕТОН — серый однородный
    makeTile("tile-concrete", 0x808080, (g) => {
      g.fillStyle(0x909090, 0.4);
      for (let i = 0; i < 5; i++) {
        g.fillCircle(Math.random()*28+2, Math.random()*28+2, Math.random()*3+1);
      }
      g.lineStyle(1, 0x606060, 0.3);
      g.lineBetween(0, 16, 32, 16);
      g.lineBetween(16, 0, 16, 32);
    });

    // РАСТЕНИЕ — небольшой куст
    const plant = this.add.graphics();
    plant.fillStyle(0x0a6030, 1);
    plant.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    plant.fillStyle(0x0d8040, 1);
    plant.fillEllipse(16, 20, 24, 16);
    plant.fillStyle(0x10a050, 0.8);
    plant.fillEllipse(10, 14, 14, 12);
    plant.fillEllipse(22, 14, 14, 12);
    plant.fillStyle(0x18c060, 0.6);
    plant.fillEllipse(16, 10, 12, 10);
    plant.fillStyle(0x5d4037, 1);
    plant.fillRect(14, 24, 4, 6);
    plant.generateTexture("tile-plant", TILE_SIZE, TILE_SIZE);
    plant.destroy();

    // СВЕТЯЩИЙСЯ ГРИБ — голубой неоновый
    const glowShroom = this.add.graphics();
    glowShroom.fillStyle(0x051528, 1);
    glowShroom.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    glowShroom.fillStyle(0x00aaff, 0.25);
    glowShroom.fillCircle(16, 12, 13);
    glowShroom.fillStyle(0x0066cc, 1);
    glowShroom.fillEllipse(16, 10, 22, 14);
    glowShroom.fillStyle(0x00aaff, 1);
    glowShroom.fillEllipse(16, 8, 18, 10);
    glowShroom.fillStyle(0xaaeeff, 0.7);
    glowShroom.fillCircle(12, 7, 2); glowShroom.fillCircle(20, 9, 1.5); glowShroom.fillCircle(16, 5, 1);
    glowShroom.fillStyle(0x55ccff, 1);
    glowShroom.fillRect(13, 14, 6, 14);
    glowShroom.fillStyle(0x00ffff, 0.15);
    glowShroom.fillCircle(16, 20, 8);
    glowShroom.generateTexture("tile-glow-mushroom", TILE_SIZE, TILE_SIZE);
    glowShroom.destroy();

    // ПЕПЕЛ — тёмно-серый
    makeTile("tile-ash", 0x333333, (g) => {
      g.fillStyle(0x444444, 0.5);
      for (let i = 0; i < 15; i++) {
        g.fillCircle(Math.random()*28+2, Math.random()*28+2, Math.random()*2+0.5);
      }
      g.fillStyle(0x888888, 0.2);
      for (let i = 0; i < 5; i++) {
        g.fillCircle(Math.random()*28+2, Math.random()*28+2, 1.5);
      }
    });

    // КОРАЛЛ — оранжево-красный подводный
    const coral = this.add.graphics();
    coral.fillStyle(0x0a2a4a, 1);
    coral.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    coral.fillStyle(0xff5500, 1);
    coral.fillRect(14, 20, 4, 10);
    coral.fillRect(8, 14, 4, 16);
    coral.fillRect(20, 16, 4, 14);
    coral.fillStyle(0xff7700, 0.8);
    coral.fillCircle(16, 18, 4);
    coral.fillCircle(10, 12, 4);
    coral.fillCircle(22, 14, 4);
    coral.fillStyle(0xffaa44, 0.5);
    coral.fillCircle(16, 16, 2); coral.fillCircle(10, 10, 2); coral.fillCircle(22, 12, 2);
    coral.generateTexture("tile-coral", TILE_SIZE, TILE_SIZE);
    coral.destroy();

    // МИФИЧЕСКОЕ ДЕРЕВО — фиолетово-розовое с кристаллами
    const mythicTree = this.add.graphics();
    mythicTree.fillStyle(0x220033, 1);
    mythicTree.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    mythicTree.fillStyle(0x3d1a55, 0.5);
    mythicTree.fillCircle(16, 28, 10);
    mythicTree.fillStyle(0x5d3a1a, 1);
    mythicTree.fillRect(13, 18, 6, 12);
    mythicTree.fillStyle(0x6600aa, 1);
    mythicTree.fillTriangle(16, 2, 3, 22, 29, 22);
    mythicTree.fillStyle(0x9933cc, 1);
    mythicTree.fillTriangle(16, 0, 7, 16, 25, 16);
    mythicTree.fillStyle(0xff66ff, 0.4);
    mythicTree.fillTriangle(16, 2, 10, 14, 22, 14);
    mythicTree.fillStyle(0xffaaff, 0.6);
    mythicTree.fillCircle(10, 10, 2); mythicTree.fillCircle(22, 8, 1.5); mythicTree.fillCircle(16, 4, 1);
    mythicTree.generateTexture("tile-mythic-tree", TILE_SIZE, TILE_SIZE);
    mythicTree.destroy();
  } // конец createTextures

  private renderTiles(force = false) {
    if (force) {
      this.tileSprites.forEach(s => s?.destroy());
      this.tileSprites = [];
    }

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const idx = y * MAP_W + x;
        const tile = this.tiles[y][x];
        const tex = this.tileTexture(tile);
        const px = x * TILE_SIZE + TILE_SIZE / 2;
        const py = y * TILE_SIZE + TILE_SIZE / 2;

        if (!this.tileSprites[idx]) {
          const img = this.add.image(px, py, tex);
          img.setDepth(5);
          img.setOrigin(0.5);
          img.setAlpha(this.tileAlpha(tile));
          this.tileSprites[idx] = img;
        } else {
          this.tileSprites[idx].setTexture(tex);
          this.tileSprites[idx].setAlpha(this.tileAlpha(tile));
        }
      }
    }
  }

  private tileAlpha(tile: TileId) {
    return tile === "water" ? 0.65 : 0.92;
  }

  private tileTexture(tile: TileId) {
    switch (tile) {
      case "grass": return "tile-grass";
      case "water": return "tile-water";
      case "rock": return "tile-rock";
      case "tree": return "tile-tree";
      case "ruins": return "tile-ruins";
      case "ice": return "tile-ice";
      case "mythic_grass": return "tile-mythic-grass";
      case "mythic_rock": return "tile-mythic-rock";
      case "crystal": return "tile-crystal";
      case "snowball": return "tile-snowball";
      case "frozen_lake": return "tile-frozen-lake";
      case "quartz": return "tile-quartz";
      case "board": return "tile-board";
      case "glass": return "tile-glass";
      case "concrete": return "tile-concrete";
      case "plant": return "tile-plant";
      case "glowing_mushroom": return "tile-glow-mushroom";
      case "ash": return "tile-ash";
      case "coral": return "tile-coral";
      default: return "tile-grass";
    }
  }

  // Получение текстуры для специальных тайлов терраформирования
  private terraformTexture(tileType: string): string {
    switch (tileType) {
      case "sand": return "tile-sand";
      case "snow": return "tile-snow";
      case "volcanic": return "tile-volcanic";
      case "cactus": return "tile-cactus";
      case "pine_snow": return "tile-pine-snow";
      case "magma": return "tile-magma";
      default: return "tile-grass";
    }
  }

  private breakTile(tx: number, ty: number, tile: TileId) {
    if (tile === "empty" || tile === "water") return;

    this.tiles[ty][tx] = "grass";
    const idx = ty * MAP_W + tx;
    if (this.tileSprites[idx]) {
      this.tileSprites[idx].setTexture("tile-grass");
      this.tileSprites[idx].setAlpha(this.tileAlpha("grass"));
    }

    const key = tile as Exclude<TileId, "empty" | "water">;
    this.inventory[key] = (this.inventory[key] ?? 0) + 1;
    this.emitInventory();

    this.cameras.main.shake(80, 0.003);
  }

  private placeTile(tx: number, ty: number) {
    // Получаем полный ключ выбранного предмета (может быть 'grass', 'tree_snow', 'rock_magma' и т.д.)
    const selectedItem = this.getSelectedItem();
    if (!selectedItem || selectedItem === "empty" || selectedItem === "water") return;

    // Разбираем биомный ключ на базовый тайл и биом
    const parts = selectedItem.split('_');
    const baseTile = parts[0] as TileId;
    const validTiles: TileId[] = ["grass", "water", "rock", "tree", "ruins", "empty"];
    if (!validTiles.includes(baseTile)) return;
    if (baseTile === "empty" || baseTile === "water") return;

    const baseKey = baseTile as Exclude<TileId, "empty" | "water">;

    // Проверяем наличие в инвентаре — единый источник правды: inventoryWithBiomes
    // Для дефолтных предметов ('rock', 'tree') биомный ключ == базовый ключ
    const biomeItem = this.inventoryWithBiomes[selectedItem];
    const simpleCount = this.inventory[baseKey] ?? 0;

    if ((!biomeItem || biomeItem.count <= 0) && simpleCount <= 0) return;

    // Определяем текстуру и tint для размещения
    const { tint: placeTint, texture: placeTexture } = this.getTintAndTextureForItem(selectedItem);

    // Обновляем карту и спрайт
    this.tiles[ty][tx] = baseTile;
    const idx = ty * MAP_W + tx;
    const sprite = this.tileSprites[idx];
    if (sprite) {
      sprite.setTexture(placeTexture);
      sprite.setAlpha(this.tileAlpha(baseTile));
      if (placeTint !== undefined) {
        sprite.setTint(placeTint);
      } else {
        sprite.clearTint();
      }
      sprite.setScale(1);

      // Сохраняем биомные данные на спрайте
      const biome = parts.length > 1 ? parts.slice(1).join('_') : 'default';
      const biomeType: BiomeType = biome === 'snow' ? 'snow' : biome === 'magma' ? 'lava' : biome === 'sand' ? 'desert' : 'default';
      sprite.setData('biome', biomeType);
      sprite.setData('type', biomeType);
      // Сохраняем полный ключ предмета для корректной добычи
      sprite.setData('itemKey', selectedItem);
    }

    // Списываем ОДИН раз — только из того инвентаря где есть
    if (biomeItem && biomeItem.count > 0) {
      biomeItem.count--;
      if (biomeItem.count <= 0) {
        delete this.inventoryWithBiomes[selectedItem];
      }
      // Синхронизируем обычный инвентарь
      this.inventory[baseKey] = Math.max(0, (this.inventory[baseKey] ?? 0) - 1);
    } else {
      // Дефолтный предмет — только в обычном инвентаре
      this.inventory[baseKey] = Math.max(0, simpleCount - 1);
    }

    this.emitInventory();
  }

  // Возвращает текстуру и tint для любого биомного ключа предмета
  private getTintAndTextureForItem(itemKey: string): { tint: number | undefined, texture: string } {
    // Специальные ключи с уникальными текстурами
    switch (itemKey) {
      case 'grass':       return { tint: undefined, texture: 'tile-grass' };
      case 'rock':        return { tint: undefined, texture: 'tile-rock' };
      case 'tree':        return { tint: undefined, texture: 'tile-tree' };
      case 'ruins':       return { tint: undefined, texture: 'tile-ruins' };

      // Снежный биом
      case 'grass_snow':  return { tint: undefined, texture: 'tile-snow' };
      case 'tree_snow':   return { tint: undefined, texture: 'tile-pine-snow' };
      case 'rock_snow':   return { tint: 0xcce5ff,  texture: 'tile-rock' };
      case 'ruins_snow':  return { tint: 0xcce5ff,  texture: 'tile-ruins' };

      // Лавовый биом
      case 'grass_magma': return { tint: undefined, texture: 'tile-magma' };
      case 'tree_magma':  return { tint: undefined, texture: 'tile-volcanic' };
      case 'rock_magma':  return { tint: 0x444444,  texture: 'tile-volcanic' };
      case 'ruins_magma': return { tint: 0x444444,  texture: 'tile-ruins' };

      // Пустынный биом
      case 'grass_sand':  return { tint: undefined, texture: 'tile-sand' };
      case 'tree_sand':   return { tint: undefined, texture: 'tile-cactus' };
      case 'rock_sand':   return { tint: 0xccbb99,  texture: 'tile-rock' };
      case 'ruins_sand':  return { tint: 0xccbb99,  texture: 'tile-ruins' };

      default: {
        // Фолбэк: парсим суффикс
        const parts = itemKey.split('_');
        const base = parts[0] as TileId;
        return { tint: undefined, texture: this.tileTexture(base) };
      }
    }
  }

  // Взаимодействие с тайлом перед игроком (клавиша F)
  private interactWithFrontTile() {
    const now = this.time.now;
    if (now - this.interactionCooldown < 300) return; // Кулдаун 300мс
    this.interactionCooldown = now;

    // Определяем направление взгляда игрока (по последней скорости или по нажатым клавишам)
    let dirX = 0, dirY = 0;
    if (this.cursors.left?.isDown || this.keys["A"]?.isDown) dirX = -1;
    else if (this.cursors.right?.isDown || this.keys["D"]?.isDown) dirX = 1;
    else if (this.cursors.up?.isDown || this.keys["W"]?.isDown) dirY = -1;
    else if (this.cursors.down?.isDown || this.keys["S"]?.isDown) dirY = 1;

    // Если игрок стоит, используем последнее направление движения
    if (dirX === 0 && dirY === 0) {
      const vel = this.playerBody.velocity;
      if (Math.abs(vel.x) > Math.abs(vel.y)) {
        dirX = vel.x > 0 ? 1 : -1;
      } else if (vel.y !== 0) {
        dirY = vel.y > 0 ? 1 : -1;
      } else {
        dirX = 1; // По умолчанию смотрим вправо
      }
    }

    // Вычисляем позицию тайла перед игроком
    const checkDistance = TILE_SIZE * 1.2;
    const checkX = this.player.x + dirX * checkDistance;
    const checkY = this.player.y + dirY * checkDistance;

    const tx = Math.floor(checkX / TILE_SIZE);
    const ty = Math.floor(checkY / TILE_SIZE);

    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return;

    const tile = this.tiles[ty][tx];

    // Ломаем только твердые объекты (дерево, камень, руины и новые объекты)
    const breakable: TileId[] = [
      "tree", "rock", "ruins", "ice", "mythic_grass", "mythic_rock",
      "crystal", "snowball", "quartz", "board", "glass", "concrete",
      "plant", "glowing_mushroom", "ash", "coral"
    ];
    if (breakable.includes(tile)) {
      this.breakTileWithEffect(tx, ty, tile);
    }
  }

  // Разрушение тайла с эффектами частиц
  private breakTileWithEffect(tx: number, ty: number, tile: TileId) {
    // Создаем эффект частиц в позиции тайла
    const px = tx * TILE_SIZE + TILE_SIZE / 2;
    const py = ty * TILE_SIZE + TILE_SIZE / 2;

    this.destructionParticles.emitParticleAt(px, py, 15);

    // Визуальный эффект тряски камеры
    this.cameras.main.shake(150, 0.005);

    // Звуковой эффект (визуальная вспышка)
    const flash = this.add.circle(px, py, TILE_SIZE, 0xff6b35, 0.3);
    flash.setDepth(25);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.5,
      duration: 300,
      onComplete: () => flash.destroy(),
    });

    const idx = ty * MAP_W + tx;
    const sprite = this.tileSprites[idx];

    // Определяем биомный ID предмета для инвентаря.
    // Приоритет: 1) itemKey сохранённый при размещении, 2) biome data, 3) текущий биом карты
    let biomeItemId: string;
    const savedItemKey = sprite?.getData('itemKey') as string | undefined;

    if (savedItemKey) {
      // Предмет был размещён вручную — берём его исходный ключ
      biomeItemId = savedItemKey;
    } else {
      // Тайл оригинальный (от терраформирования или генерации)
      const tileBiome = (sprite?.getData('biome') as BiomeType) || this.currentBiome;
      biomeItemId = this.getBiomeItemId(tile, tileBiome);
    }

    // Обновляем тайл — возвращаем траву (или подходящий фон биома)
    const underlyingTile: TileId = "grass";
    this.tiles[ty][tx] = underlyingTile;
    if (sprite) {
      // Под снежным/лавовым/пустынным деревом/объектом кладём соответствующий фон
      const tileBiome = (sprite.getData('biome') as BiomeType) || this.currentBiome;
      const { texture: bgTexture, tint: bgTint } = this.getGroundTextureForBiome(tileBiome);
      sprite.setTexture(bgTexture);
      sprite.setAlpha(this.tileAlpha(underlyingTile));
      if (bgTint !== undefined) {
        sprite.setTint(bgTint);
      } else {
        sprite.clearTint();
      }
      sprite.setScale(1);
      sprite.setData('type', tileBiome === 'default' ? 'default' : tileBiome);
      sprite.setData('biome', tileBiome === 'default' ? 'default' : tileBiome);
      sprite.setData('itemKey', null);
    }

    // Добавляем предмет в inventoryWithBiomes (единый источник правды)
    const baseKey = tile as Exclude<TileId, "empty" | "water">;
    if (!this.inventoryWithBiomes[biomeItemId]) {
      const biomeType = this.getBiomeTypeFromItemId(biomeItemId);
      this.inventoryWithBiomes[biomeItemId] = { 
        id: baseKey, 
        type: biomeType,
        tint: undefined, 
        scale: 1,
        count: 0 
      };
    }
    this.inventoryWithBiomes[biomeItemId].count++;
    
    // Синхронизируем обычный инвентарь (по базовому ключу — для обратной совместимости)
    this.inventory[baseKey] = (this.inventory[baseKey] ?? 0) + 1;
    this.emitInventory();

    // Генерируем событие для React
    const biomeType = this.getBiomeTypeFromItemId(biomeItemId);
    gameEvents.emit('block-collected', { 
      type: biomeItemId, 
      amount: 1,
      baseId: baseKey,
      biome: biomeType
    });

    console.log("Добыт предмет:", biomeItemId);

    // Показываем всплывающий текст
    const displayName = this.getItemDisplayName(biomeItemId);
    this.showFloatingText(px, py, `+1 ${displayName}`);
  }

  // Возвращает биомный ключ предмета для инвентаря на основе базового тайла и биома
  private getBiomeItemId(tile: TileId, biome: BiomeType): string {
    if (biome === 'default') return tile;
    const suffix = biome === 'lava' ? 'magma' : biome === 'desert' ? 'sand' : biome;
    return `${tile}_${suffix}`;
  }

  // Извлекает BiomeType из ключа предмета
  private getBiomeTypeFromItemId(itemId: string): BiomeType {
    if (itemId.endsWith('_snow')) return 'snow';
    if (itemId.endsWith('_magma')) return 'lava';
    if (itemId.endsWith('_sand')) return 'desert';
    return 'default';
  }

  // Возвращает текстуру земли под объектом в зависимости от биома
  private getGroundTextureForBiome(biome: BiomeType): { texture: string, tint: number | undefined } {
    switch (biome) {
      case 'snow':   return { texture: 'tile-snow',     tint: undefined };
      case 'lava':   return { texture: 'tile-magma',    tint: undefined };
      case 'desert': return { texture: 'tile-sand',     tint: undefined };
      default:       return { texture: 'tile-grass',    tint: undefined };
    }
  }

  // Читабельное название для любого биомного ключа
  private getItemDisplayName(itemId: string): string {
    const names: Record<string, string> = {
      'grass':       'Трава',
      'rock':        'Камень',
      'tree':        'Дерево',
      'ruins':       'Руины',
      'grass_snow':  'Снежная трава',
      'rock_snow':   'Снежный камень',
      'tree_snow':   'Снежное дерево',
      'ruins_snow':  'Снежные руины',
      'grass_magma': 'Магматическая порода',
      'rock_magma':  'Магматический камень',
      'tree_magma':  'Уголь',
      'ruins_magma': 'Обугленные руины',
      'grass_sand':  'Песок',
      'rock_sand':   'Песчаный камень',
      'tree_sand':   'Кактус',
      'ruins_sand':  'Руины пустыни',
      // Новые объекты
      'ice':             '🧊 Лёд',
      'mythic_grass':    '✨ Мифическая трава',
      'mythic_rock':     '💜 Мифический камень',
      'crystal':         '💎 Кристалл',
      'snowball':        '⚪ Снежный комок',
      'frozen_lake':     '🧊 Замёрзшее озеро',
      'quartz':          '🔮 Кварц',
      'board':           '🪵 Доска',
      'glass':           '🪟 Стекло',
      'concrete':        '🧱 Бетон',
      'plant':           '🌿 Растение',
      'glowing_mushroom':'💡 Светящийся гриб',
      'ash':             '💨 Пепел',
      'coral':           '🪸 Коралл',
    };
    return names[itemId] ?? itemId;
  }

  // Показ всплывающего текста
  private showFloatingText(x: number, y: number, text: string) {
    const style = {
      fontFamily: 'Arial',
      fontSize: '14px',
      color: '#ff6b35',
      stroke: '#000000',
      strokeThickness: 3,
    };

    const txt = this.add.text(x, y - 10, text, style);
    txt.setDepth(30);
    txt.setOrigin(0.5);

    this.tweens.add({
      targets: txt,
      y: y - 40,
      alpha: 0,
      duration: 1000,
      onComplete: () => txt.destroy(),
    });
  }

  private emitInventory() {
    // Строим плоский инвентарь с биомными ключами для React UI
    // (например: { 'rock': 5, 'tree_snow': 3, 'rock_magma': 2 })
    const flatInventory: Record<string, number> = {};
    for (const [key, item] of Object.entries(this.inventoryWithBiomes)) {
      if (item.count > 0) {
        flatInventory[key] = item.count;
      }
    }
    this.onInventory(flatInventory);
    // Также отправляем расширенный инвентарь с биомами, если колбэк задан
    if (this.callbacks?.onInventoryWithBiomes) {
      this.callbacks.onInventoryWithBiomes({ ...this.inventoryWithBiomes });
    }
  }

  setCallbacks(cb: GameCallbacks) {
    this.callbacks = cb;
    this.onInventory = cb.onInventory;
    this.getSelectedTile = cb.getSelectedTile;
    this.getSelectedItem = cb.getSelectedItem;
  }

  // Точечный патч карты — меняет только конкретные тайлы по описанию
  // НЕ меняет биом и не трогает остальные тайлы
  patchMap(prompt: string) {
    if (!prompt) return;
    const t = prompt.toLowerCase();

    // Парсим: ЧТО заменить и НА ЧТО
    // Форматы: "замени камни на песок", "вместо деревьев поставь кактусы", "убери воду"
    type TileKey = TileId | "cactus" | "pine" | "coal" | "volcanic";

    // Словарь распознавания тайлов из текста
    const tileFromText = (s: string): { tile: TileId; texture: string; tint?: number; biome: BiomeType } | null => {
      if (/камн|скал|рок/.test(s))    return { tile: "rock",  texture: "tile-rock",       biome: this.currentBiome };
      if (/дерев|лес|ель|сосн/.test(s)) return { tile: "tree",  texture: "tile-tree",       biome: this.currentBiome };
      if (/трав|луг|земл/.test(s))     return { tile: "grass", texture: "tile-grass",      biome: this.currentBiome };
      if (/вод|озер|рек|мор/.test(s))  return { tile: "water", texture: "tile-water",      biome: this.currentBiome };
      if (/руин|замок|храм/.test(s))   return { tile: "ruins", texture: "tile-ruins",      biome: this.currentBiome };
      // Биомные варианты
      if (/снег|лёд|тундр/.test(s))   return { tile: "grass", texture: "tile-snow",       biome: "snow" };
      if (/магм|лав|огонь/.test(s))   return { tile: "grass", texture: "tile-magma",      biome: "lava" };
      if (/вулкан/.test(s))           return { tile: "rock",  texture: "tile-volcanic",   biome: "lava" };
      if (/песок|пустын/.test(s))     return { tile: "grass", texture: "tile-sand",       biome: "desert" };
      if (/кактус/.test(s))           return { tile: "tree",  texture: "tile-cactus",     biome: "desert" };
      if (/уголь/.test(s))            return { tile: "tree",  texture: "tile-volcanic",   tint: 0x333333, biome: "lava" };
      if (/ель|pine|снежн.*дерев/.test(s)) return { tile: "tree", texture: "tile-pine-snow", biome: "snow" };
      if (/руин.*снег|снеж.*руин/.test(s)) return { tile: "ruins", texture: "tile-ruins", tint: 0xcce5ff, biome: "snow" };
      return null;
    };

    // Паттерны для извлечения FROM и TO
    let fromDef: ReturnType<typeof tileFromText> = null;
    let toDef: ReturnType<typeof tileFromText> = null;

    // "замени X на Y" / "поменяй X на Y"
    const replaceMatch = t.match(/(?:замен[ия]|поменя[йи])\s+(.+?)\s+на\s+(.+)/);
    if (replaceMatch) {
      fromDef = tileFromText(replaceMatch[1]);
      toDef   = tileFromText(replaceMatch[2]);
    }

    // "вместо X на/поставь Y" / "вместо X — Y"
    const insteadMatch = t.match(/вместо\s+(.+?)\s+(?:на|поставь|—|-)\s+(.+)/);
    if (!replaceMatch && insteadMatch) {
      fromDef = tileFromText(insteadMatch[1]);
      toDef   = tileFromText(insteadMatch[2]);
    }

    // "добавь X" — добавляем поверх травы
    const addMatch = t.match(/добав[ьи]\s+(.+)/);
    if (!replaceMatch && !insteadMatch && addMatch) {
      fromDef = { tile: "grass", texture: "tile-grass", biome: this.currentBiome };
      toDef   = tileFromText(addMatch[1]);
    }

    // "убери X" / "удали X" — заменяем на траву
    const removeMatch = t.match(/(?:убер[иь]|удал[иь]|очист[иь])\s+(.+)/);
    if (!replaceMatch && !insteadMatch && !addMatch && removeMatch) {
      fromDef = tileFromText(removeMatch[1]);
      const groundTex = this.currentBiome === 'snow' ? 'tile-snow' :
                        this.currentBiome === 'lava' ? 'tile-magma' :
                        this.currentBiome === 'desert' ? 'tile-sand' : 'tile-grass';
      toDef = { tile: "grass", texture: groundTex, biome: this.currentBiome };
    }

    if (!fromDef || !toDef) {
      console.log("[patchMap] Не распознано:", t);
      return;
    }

    console.log(`[patchMap] ${fromDef.tile}(${fromDef.texture}) → ${toDef.tile}(${toDef.texture})`);

    let count = 0;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const idx = y * MAP_W + x;
        const currentTile = this.tiles[y][x];
        const sprite = this.tileSprites[idx];
        if (!sprite) continue;

        // Проверяем совпадение по типу тайла
        if (currentTile !== fromDef.tile) continue;

        // Дополнительно проверяем биом тайла если fromDef биомный
        if (fromDef.biome !== 'default' && fromDef.biome !== this.currentBiome) {
          const spriteBiome = sprite.getData('biome') as BiomeType;
          if (spriteBiome !== fromDef.biome) continue;
        }

        // Применяем замену
        this.tiles[y][x] = toDef.tile;
        sprite.setTexture(toDef.texture);
        sprite.setAlpha(this.tileAlpha(toDef.tile));
        sprite.setScale(1);
        if (toDef.tint !== undefined) {
          sprite.setTint(toDef.tint);
        } else {
          sprite.clearTint();
        }
        sprite.setData('biome', toDef.biome);
        sprite.setData('type', toDef.biome);
        sprite.setData('itemKey', null);
        count++;
      }
    }

    // Перемещаем игрока если встал на непроходимый тайл
    this.repositionPlayerOnWalkable();

    this.cameras.main.shake(150, 0.003);
    this.showFloatingText(this.player.x, this.player.y - 50, `✏️ Заменено: ${count} тайлов`);
    console.log(`[patchMap] Заменено ${count} тайлов`);
  }
  private terraformMap(prompt: string) {
    if (!prompt) return;
    const text = prompt.toLowerCase();

    // === РАСШИРЕННЫЙ СЛОВАРЬ КЛЮЧЕВЫХ СЛОВ ===
    const isLava    = /лав|вулкан|магм|огн|пекл|ад|пламен|горящ|раскален|инферн/.test(text);
    const isDesert  = /песок|пустын|засух|сух|сахар|барх|знойн|аридн|кактус/.test(text);
    const isSnow    = /снег|зим|холод|лёд|лед|мороз|тундр|арктик|северн|вьюг|пургa|замёрз/.test(text);
    const isSwamp   = /болот|топ|трясин|туман|гнил|мшист/.test(text);
    const isJungle  = /джунгл|тропик|экватор|лиан|влажн|буйн/.test(text);
    const isOcean   = /океан|море|вод|затоплен|остров/.test(text);
    const isForest  = /лес|роща|дерев|чащ|бор/.test(text);
    const isRuins   = /руин|город|храм|замок|древн|цивилиз|забыт|мёртв/.test(text);

    // Определяем доминирующий биом
    let newBiome: BiomeType = "default";
    if (isLava)   newBiome = "lava";
    else if (isDesert) newBiome = "desert";
    else if (isSnow)   newBiome = "snow";

    // Если ни один биом не распознан — делаем процедурный лесной/луговой биом
    if (newBiome === "default" && !isForest && !isJungle && !isSwamp && !isOcean && !isRuins) {
      console.log("Терраформирование: сброс к исходному состоянию");
      this.currentBiome = "default";
      this.renderTiles(true);
      this.repositionPlayerOnWalkable();
      return;
    }

    console.log("Терраформирование:", text, "→ биом:", newBiome);

    // ШАГ 1: Сброс всех tint и данных
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const idx = y * MAP_W + x;
        if (this.tileSprites[idx]) {
          this.tileSprites[idx].clearTint();
          this.tileSprites[idx].setScale(1);
          this.tileSprites[idx].setData('type', 'default');
          this.tileSprites[idx].setData('biome', 'default');
          this.tileSprites[idx].setData('itemKey', null);
        }
      }
    }

    this.currentBiome = newBiome;

    // ШАГ 2: Применяем биом
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const idx = y * MAP_W + x;
        const tile = this.tiles[y][x];
        const sprite = this.tileSprites[idx];
        if (!sprite || !sprite.scene || !sprite.active) continue;

        if (newBiome === "lava") {
          this.applyLavaTile(x, y, tile, sprite, idx);
        } else if (newBiome === "desert") {
          this.applyDesertTile(x, y, tile, sprite, idx);
        } else if (newBiome === "snow") {
          this.applySnowTile(x, y, tile, sprite, idx);
        } else {
          // Дефолт — применяем модификаторы (лес, болото, океан, руины)
          this.applyDefaultModifiers(x, y, tile, sprite, idx, { isSwamp, isJungle, isOcean, isForest, isRuins });
        }
      }
    }

    // ШАГ 3: Добавляем дополнительные элементы по запросу
    const r = () => Math.random();

    // Руины — разбрасываем по карте
    if (isRuins) {
      const count = 8 + Math.floor(r() * 12);
      for (let i = 0; i < count; i++) {
        const rx = Math.floor(r() * MAP_W);
        const ry = Math.floor(r() * MAP_H);
        if (this.tiles[ry][rx] !== "water") {
          this.tiles[ry][rx] = "ruins";
          const ridx = ry * MAP_W + rx;
          if (this.tileSprites[ridx]) {
            const tint = newBiome === 'snow' ? 0xcce5ff : newBiome === 'lava' ? 0x444444 : newBiome === 'desert' ? 0xccbb99 : undefined;
            this.tileSprites[ridx].setTexture("tile-ruins");
            if (tint) this.tileSprites[ridx].setTint(tint);
            this.tileSprites[ridx].setData('biome', newBiome);
          }
        }
      }
    }

    // Лес — добавляем деревья
    if (isForest || isJungle) {
      const count = 30 + Math.floor(r() * 40);
      for (let i = 0; i < count; i++) {
        const rx = Math.floor(r() * MAP_W);
        const ry = Math.floor(r() * MAP_H);
        if (this.tiles[ry][rx] === "grass") {
          this.tiles[ry][rx] = "tree";
          const tidx = ry * MAP_W + rx;
          if (this.tileSprites[tidx]) {
            const tex = newBiome === 'snow' ? 'tile-pine-snow' : 'tile-tree';
            const tint = isJungle ? 0x1a6b20 : undefined;
            this.tileSprites[tidx].setTexture(tex);
            if (tint) this.tileSprites[tidx].setTint(tint);
            this.tileSprites[tidx].setData('biome', newBiome);
          }
        }
      }
    }

    // Болото — темнеем воду и траву
    if (isSwamp) {
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          const idx = y * MAP_W + x;
          if (this.tiles[y][x] === "water") {
            this.tileSprites[idx]?.setTint(0x3d5a2a);
          } else if (this.tiles[y][x] === "grass") {
            this.tileSprites[idx]?.setTint(0x4a6b3a);
          }
        }
      }
    }

    // Перемещаем игрока если он стоит на непроходимом тайле
    this.repositionPlayerOnWalkable();

    this.cameras.main.shake(300, 0.006);
    this.showFloatingText(this.player.x, this.player.y - 50, `🌍 ${this.getBiomeDisplayName(newBiome, { isSwamp, isJungle, isForest, isRuins })}`);
    console.log("Терраформирование завершено! Биом:", newBiome);
  }

  // === НОВЫЙ МЕТОД: Мгновенная смена биома по команде AI ===
  // Закрашивает ВСЮ карту нужными тайлами в зависимости от биома
  applyBiome(biomeType: string) {
    const biomeMap: Record<string, BiomeType> = {
      snow: "snow", winter: "snow", ice: "snow",
      lava: "lava", volcanic: "lava", magma: "lava", fire: "lava",
      desert: "desert", sand: "desert",
      grass: "default", forest: "default", default: "default",
    };

    const newBiome = biomeMap[biomeType.toLowerCase()] ?? "default";
    console.log("applyBiome:", biomeType, "→", newBiome);

    // Сброс всех tint и данных
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const idx = y * MAP_W + x;
        if (this.tileSprites[idx]) {
          this.tileSprites[idx].clearTint();
          this.tileSprites[idx].setScale(1);
          this.tileSprites[idx].setData('type', 'default');
          this.tileSprites[idx].setData('biome', 'default');
          this.tileSprites[idx].setData('itemKey', null);
        }
      }
    }

    this.currentBiome = newBiome;

    // Применяем биом ко всей карте
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const idx = y * MAP_W + x;
        const tile = this.tiles[y][x];
        const sprite = this.tileSprites[idx];
        // Критическая проверка: спрайт может быть уничтожен (биомная смена уничтожает старые текстуры)
        if (!sprite || !sprite.scene || !sprite.active) continue;

        if (newBiome === "lava") {
          this.applyLavaTile(x, y, tile, sprite, idx);
        } else if (newBiome === "desert") {
          this.applyDesertTile(x, y, tile, sprite, idx);
        } else if (newBiome === "snow") {
          this.applySnowTile(x, y, tile, sprite, idx);
        } else {
          // Default biome — просто возвращаем базовые текстуры
          sprite.setTexture(this.tileTexture(tile));
          sprite.clearTint();
          sprite.setData('biome', 'default');
          sprite.setData('type', 'default');
        }
      }
    }

    // === БЕЗОПАСНАЯ ЗОНА: расчищаем 3x3 вокруг игрока ===
    this.clearSafeZone();

    this.cameras.main.shake(400, 0.008);
    this.showFloatingText(this.player.x, this.player.y - 60, `🌍 Биом: ${biomeType}`);
    console.log("applyBiome завершено!");
  }

  // === БЕЗОПАСНАЯ ЗОНА ===
  // Расчищает квадрат 3x3 вокруг игрока от коллизий и сбрасывает velocity
  // Вызывается после ЛЮБОГО изменения карты
  private clearSafeZone() {
    const px = Math.floor(this.player.x / TILE_SIZE);
    const py = Math.floor(this.player.y / TILE_SIZE);

    // Расчищаем 3x3 вокруг игрока (заменяем непроходимые тайлы на траву)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = px + dx;
        const ty = py + dy;
        if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) continue;

        const tile = this.tiles[ty][tx];
        // Если тайл непроходимый — заменяем на траву
        if (tile === "water" || tile === "tree" || tile === "rock" || tile === "ruins"
          || tile === "frozen_lake" || tile === "mythic_rock" || tile === "quartz"
          || tile === "glass" || tile === "concrete" || tile === "coral") {

          this.tiles[ty][tx] = "grass";
          const idx = ty * MAP_W + tx;
          const sprite = this.tileSprites[idx];
          if (sprite) {
            sprite.setTexture("tile-grass");
            sprite.clearTint();
            sprite.setAlpha(this.tileAlpha("grass"));
            sprite.setScale(1);
            sprite.setData('biome', 'default');
            sprite.setData('type', 'default');
            sprite.setData('itemKey', null);
          }
        }
      }
    }

    // Сбрасываем velocity чтобы игрок не застревал
    if (this.playerBody) {
      this.playerBody.setVelocity(0, 0);
    }

    // Проверяем что игрок на проходимом тайле
    this.repositionPlayerOnWalkable();
  }

  private getBiomeDisplayName(biome: BiomeType, flags: Record<string, boolean>): string {
    if (flags.isSwamp) return 'Болотный биом';
    if (flags.isJungle) return 'Джунгли';
    if (flags.isForest) return 'Лесной биом';
    if (flags.isRuins) return 'Руины';
    switch (biome) {
      case 'lava': return 'Лавовый биом';
      case 'desert': return 'Пустынный биом';
      case 'snow': return 'Снежный биом';
      default: return 'Биом обновлён';
    }
  }

  private applyLavaTile(x: number, y: number, tile: TileId, sprite: Phaser.GameObjects.Image, idx: number) {
    const r = Math.random();
    if (tile === "grass") {
      if (r > 0.35) {
        this.tiles[y][x] = "rock";
        sprite.setTexture("tile-volcanic");
      } else {
        sprite.setTexture("tile-magma");
      }
      sprite.setData('biome', 'lava'); sprite.setData('type', 'lava');
    } else if (tile === "tree") {
      // Дерево → уголь (тёмный вулканический) или магма
      if (r > 0.5) {
        this.tiles[y][x] = "rock";
        sprite.setTexture("tile-volcanic");
        sprite.setTint(0x333333);
      } else {
        this.tiles[y][x] = "grass";
        sprite.setTexture("tile-magma");
      }
      sprite.setData('biome', 'lava'); sprite.setData('type', 'lava');
    } else if (tile === "rock" || tile === "ruins") {
      sprite.setTint(0x444444);
      sprite.setData('biome', 'lava'); sprite.setData('type', 'lava');
    } else if (tile === "water") {
      sprite.setTint(0xff4400);
      sprite.setData('biome', 'lava'); sprite.setData('type', 'lava');
    }
  }

  private applyDesertTile(x: number, y: number, tile: TileId, sprite: Phaser.GameObjects.Image, idx: number) {
    const r = Math.random();
    if (tile === "grass") {
      sprite.setTexture("tile-sand");
      sprite.setData('biome', 'desert'); sprite.setData('type', 'desert');
    } else if (tile === "tree") {
      // Дерево → кактус (60%) или песок (40%)
      if (r > 0.4) {
        sprite.setTexture("tile-cactus");
      } else {
        this.tiles[y][x] = "grass";
        sprite.setTexture("tile-sand");
      }
      sprite.setData('biome', 'desert'); sprite.setData('type', 'desert');
    } else if (tile === "rock" || tile === "ruins") {
      sprite.setTint(0xccbb99);
      sprite.setData('biome', 'desert'); sprite.setData('type', 'desert');
    } else if (tile === "water") {
      // Пересохший водоём → оазис или песок
      if (r > 0.7) {
        sprite.setTint(0x8ba888); // оазис — зеленоватый
      } else {
        sprite.setTint(0xedc9af); // пересохший — песочный
      }
      sprite.setData('biome', 'desert'); sprite.setData('type', 'desert');
    }
    // Рассыпаем доп. кактусы
    if (tile === "grass" && r > 0.88) {
      this.tiles[y][x] = "tree";
      sprite.setTexture("tile-cactus");
    }
  }

  private applySnowTile(x: number, y: number, tile: TileId, sprite: Phaser.GameObjects.Image, idx: number) {
    if (tile === "grass") {
      sprite.setTexture("tile-snow");
      sprite.setData('biome', 'snow'); sprite.setData('type', 'snow');
    } else if (tile === "tree") {
      sprite.setTexture("tile-pine-snow");
      sprite.setData('biome', 'snow'); sprite.setData('type', 'snow');
    } else if (tile === "rock" || tile === "ruins") {
      sprite.setTint(0xcce5ff);
      sprite.setData('biome', 'snow'); sprite.setData('type', 'snow');
    } else if (tile === "water") {
      sprite.setTint(0x88ccff); // лёд
      sprite.setData('biome', 'snow'); sprite.setData('type', 'snow');
    }
  }

  private applyDefaultModifiers(x: number, y: number, tile: TileId, sprite: Phaser.GameObjects.Image, idx: number, flags: Record<string, boolean>) {
    // Просто возвращаем дефолтные текстуры — без изменений
    sprite.setTexture(this.tileTexture(tile));
    sprite.clearTint();
    sprite.setData('biome', 'default'); sprite.setData('type', 'default');
  }

  // Применяет карту тайлов сгенерированную AI
  applyAiGeneratedMap(biome: string, mapRows: string[]) {
    // === АБСОЛЮТНЫЙ ВАЙП (Hard Reset) карты ===
    // КРИТИЧЕСКИ ВАЖНО: старые деревья, руины и льдины должны исчезать бесследно
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const idx = y * MAP_W + x;
        this.tiles[y][x] = "grass";
        const sprite = this.tileSprites[idx];
        if (sprite) {
          sprite.clearTint();
          sprite.setScale(1);
          sprite.setData('type', 'default');
          sprite.setData('biome', 'default');
          sprite.setData('itemKey', null);
        }
      }
    }

    const biomeMap: Record<string, BiomeType> = {
      snow: "snow", winter: "snow", ice: "snow", tundra: "snow",
      lava: "lava", volcanic: "lava", magma: "lava", fire: "lava",
      desert: "desert", sand: "desert", arid: "desert",
      forest: "default", default: "default", swamp: "default",
      meadow: "default", jungle: "default",
    };
    this.currentBiome = biomeMap[biome.toLowerCase()] ?? "default";

    // Расширенная таблица символов — охватывает все биомы и объекты
    const charMap: Record<string, { tile: TileId; texture: string; tint?: number; biome: BiomeType }> = {
      // === БАЗОВЫЕ ===
      "G": { tile: "grass",  texture: "tile-grass",     biome: "default" },
      "W": { tile: "water",  texture: "tile-water",     biome: "default" },
      "R": { tile: "rock",   texture: "tile-rock",      biome: "default" },
      "T": { tile: "tree",   texture: "tile-tree",      biome: "default" },
      "U": { tile: "ruins",  texture: "tile-ruins",     biome: "default" },
      "E": { tile: "grass",  texture: "tile-grass",     biome: "default" }, // empty → трава
      // === СНЕЖНЫЙ БИОМ ===
      "S": { tile: "grass",  texture: "tile-snow",      biome: "snow" },    // снег/тундра
      "I": { tile: "rock",   texture: "tile-rock",      tint: 0xcce5ff, biome: "snow" }, // ледяной камень
      "P": { tile: "tree",   texture: "tile-pine-snow", biome: "snow" },    // снежная ель
      "L": { tile: "water",  texture: "tile-water",     tint: 0x88ccff, biome: "snow" }, // лёд/замёрзшая вода
      "J": { tile: "ruins",  texture: "tile-ruins",     tint: 0xcce5ff, biome: "snow" }, // снежные руины
      // === ЛАВОВЫЙ БИОМ ===
      "M": { tile: "grass",  texture: "tile-magma",     biome: "lava" },    // магматическая порода
      "V": { tile: "rock",   texture: "tile-volcanic",  biome: "lava" },    // вулканический камень
      "C": { tile: "tree",   texture: "tile-volcanic",  tint: 0x333333, biome: "lava" }, // уголь (тёмный)
      "F": { tile: "water",  texture: "tile-water",     tint: 0xff4400, biome: "lava" }, // лава/огонь
      "X": { tile: "ruins",  texture: "tile-ruins",     tint: 0x444444, biome: "lava" }, // обугленные руины
      // === ПУСТЫННЫЙ БИОМ ===
      "D": { tile: "grass",  texture: "tile-sand",      biome: "desert" },  // песок
      "N": { tile: "rock",   texture: "tile-rock",      tint: 0xccbb99, biome: "desert" }, // песчаный камень
      "K": { tile: "tree",   texture: "tile-cactus",    biome: "desert" },  // кактус
      "O": { tile: "water",  texture: "tile-water",     tint: 0x8ba888, biome: "desert" }, // оазис
      "Q": { tile: "ruins",  texture: "tile-ruins",     tint: 0xccbb99, biome: "desert" }, // руины пустыни
      // === ГРИБНОЙ/БОЛОТНЫЙ БИОМ ===
      "B": { tile: "grass",  texture: "tile-grass",     tint: 0x4a6b3a, biome: "default" }, // болото
      "H": { tile: "tree",   texture: "tile-tree",      tint: 0x7a3a8a, biome: "default" }, // мистический лес
      // === НОВЫЕ ОБЪЕКТЫ ===
      "i": { tile: "ice",           texture: "tile-ice",          biome: "snow"    },
      "Y": { tile: "mythic_grass",  texture: "tile-mythic-grass", biome: "default" },
      "y": { tile: "mythic_rock",   texture: "tile-mythic-rock",  biome: "default" },
      "c": { tile: "crystal",       texture: "tile-crystal",      biome: "default" },
      "z": { tile: "snowball",      texture: "tile-snowball",     biome: "snow"    },
      "l": { tile: "frozen_lake",   texture: "tile-frozen-lake",  biome: "snow"    },
      "q": { tile: "quartz",        texture: "tile-quartz",       biome: "default" },
      "b": { tile: "board",         texture: "tile-board",        biome: "default" },
      "a": { tile: "glass",         texture: "tile-glass",        biome: "default" },
      "e": { tile: "concrete",      texture: "tile-concrete",     biome: "default" },
      "p": { tile: "plant",         texture: "tile-plant",        biome: "default" },
      "g": { tile: "glowing_mushroom", texture: "tile-glow-mushroom", biome: "default" },
      "r": { tile: "ash",           texture: "tile-ash",          biome: "default" },
      "o": { tile: "coral",         texture: "tile-coral",        biome: "default" },
      "A": { tile: "mythic_grass",  texture: "tile-mythic-grass", tint: 0xff66ff, biome: "default" }, // мифич. биом фон
      // === АЛЬТЕРНАТИВНЫЕ ПСЕВДОНИМЫ (на случай если AI пишет цифры или другие буквы) ===
      "0": { tile: "grass",  texture: "tile-grass",     biome: "default" },
      "1": { tile: "rock",   texture: "tile-rock",      biome: "default" },
      "2": { tile: "water",  texture: "tile-water",     biome: "default" },
      "3": { tile: "tree",   texture: "tile-tree",      biome: "default" },
      "4": { tile: "ruins",  texture: "tile-ruins",     biome: "default" },
      "5": { tile: "grass",  texture: "tile-snow",      biome: "snow" },
      "6": { tile: "grass",  texture: "tile-magma",     biome: "lava" },
      "7": { tile: "grass",  texture: "tile-sand",      biome: "desert" },
      "8": { tile: "tree",   texture: "tile-pine-snow", biome: "snow" },
      "9": { tile: "tree",   texture: "tile-cactus",    biome: "desert" },
    };

    // Применяем карту
    for (let y = 0; y < Math.min(mapRows.length, MAP_H); y++) {
      const row = mapRows[y] ?? "";
      for (let x = 0; x < Math.min(row.length, MAP_W); x++) {
        const char = row[x] ?? "G";
        const def = charMap[char] ?? charMap["G"]!;
        const idx = y * MAP_W + x;
        const sprite = this.tileSprites[idx];

        this.tiles[y][x] = def.tile;

        if (sprite) {
          sprite.setTexture(def.texture);
          sprite.setAlpha(this.tileAlpha(def.tile));
          sprite.setScale(1);
          if (def.tint !== undefined) {
            sprite.setTint(def.tint);
          } else {
            sprite.clearTint();
          }
          sprite.setData("biome", def.biome);
          sprite.setData("type", def.biome);
          sprite.setData("itemKey", null);
        }
      }
    }

    // Заполняем незаполненные строки/столбцы (если AI прислал меньше 64 строк)
    const receivedRows = Math.min(mapRows.length, MAP_H);
    const receivedCols = mapRows[0]?.length ?? 0;
    if (receivedRows < MAP_H || receivedCols < MAP_W) {
      const fallbackTile = this.currentBiome === 'snow' ? 
        { tile: "grass" as TileId, texture: "tile-snow", biome: "snow" as BiomeType } :
        this.currentBiome === 'lava' ? 
        { tile: "grass" as TileId, texture: "tile-magma", biome: "lava" as BiomeType } :
        this.currentBiome === 'desert' ? 
        { tile: "grass" as TileId, texture: "tile-sand", biome: "desert" as BiomeType } :
        { tile: "grass" as TileId, texture: "tile-grass", biome: "default" as BiomeType };

      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          if (y >= receivedRows || x >= (mapRows[y]?.length ?? 0)) {
            const idx = y * MAP_W + x;
            this.tiles[y][x] = fallbackTile.tile;
            const sprite = this.tileSprites[idx];
            if (sprite) {
              sprite.setTexture(fallbackTile.texture);
              sprite.clearTint();
              sprite.setAlpha(0.92);
              sprite.setScale(1);
              sprite.setData("biome", fallbackTile.biome);
              sprite.setData("type", fallbackTile.biome);
            }
          }
        }
      }
    }

    // Перемещаем игрока на проходимый тайл после смены карты
    this.repositionPlayerOnWalkable();

    this.cameras.main.shake(400, 0.008);
    this.showFloatingText(this.player.x, this.player.y - 60, "🗺️ Карта сгенерирована!");
    console.log(`[Phaser] AI карта применена: биом=${biome}, rows=${mapRows.length}`);
  }

  // Перемещает игрока на ближайший проходимый тайл

  // Применяет точечные изменения от AI (modify_area)
  private applyAiChanges(changes: Array<{x: number; y: number; tile: string}>) {
    const charMap: Record<string, { tile: TileId; texture: string; tint?: number; biome: BiomeType }> = {
      "G": { tile: "grass", texture: "tile-grass",     biome: "default" },
      "W": { tile: "water", texture: "tile-water",     biome: "default" },
      "R": { tile: "rock",  texture: "tile-rock",      biome: "default" },
      "T": { tile: "tree",  texture: "tile-tree",      biome: "default" },
      "U": { tile: "ruins", texture: "tile-ruins",     biome: "default" },
      "E": { tile: "grass", texture: "tile-grass",     biome: "default" },
      "S": { tile: "grass", texture: "tile-snow",      biome: "snow" },
      "I": { tile: "rock",  texture: "tile-rock",      tint: 0xcce5ff, biome: "snow" },
      "P": { tile: "tree",  texture: "tile-pine-snow", biome: "snow" },
      "L": { tile: "water", texture: "tile-water",     tint: 0x88ccff, biome: "snow" },
      "M": { tile: "grass", texture: "tile-magma",     biome: "lava" },
      "V": { tile: "rock",  texture: "tile-volcanic",  biome: "lava" },
      "C": { tile: "tree",  texture: "tile-volcanic",  tint: 0x333333, biome: "lava" },
      "F": { tile: "water", texture: "tile-water",     tint: 0xff4400, biome: "lava" },
      "D": { tile: "grass", texture: "tile-sand",      biome: "desert" },
      "N": { tile: "rock",  texture: "tile-rock",      tint: 0xccbb99, biome: "desert" },
      "K": { tile: "tree",  texture: "tile-cactus",    biome: "desert" },
      "H": { tile: "rock",  texture: "tile-rock",      tint: 0x8b7355, biome: "default" },
      "B": { tile: "grass", texture: "tile-grass",     tint: 0x888888, biome: "default" },
      "A": { tile: "rock",  texture: "tile-rock",      tint: 0xffdd88, biome: "default" },
      "Z": { tile: "ruins", texture: "tile-ruins",     tint: 0xddaa44, biome: "default" },
      "O": { tile: "rock",  texture: "tile-rock",      tint: 0x8b4513, biome: "default" },
      "X": { tile: "tree",  texture: "tile-tree",      tint: 0x228b22, biome: "default" },
      "J": { tile: "tree",  texture: "tile-tree",      tint: 0xaa44aa, biome: "default" },
      "Q": { tile: "ruins", texture: "tile-ruins",     tint: 0xccaa88, biome: "default" },
      "Y": { tile: "rock",  texture: "tile-rock",      tint: 0x6699cc, biome: "default" },
    };

    for (const change of changes) {
      const { x, y, tile } = change;
      if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) continue;
      const def = charMap[tile] ?? charMap["G"]!;
      const idx = y * MAP_W + x;
      const sprite = this.tileSprites[idx];
      if (!sprite) continue;
      this.tiles[y][x] = def.tile;
      sprite.setTexture(def.texture);
      sprite.setAlpha(this.tileAlpha(def.tile));
      sprite.setScale(1);
      if (def.tint !== undefined) sprite.setTint(def.tint);
      else sprite.clearTint();
      sprite.setData("biome", def.biome);
    }

    this.repositionPlayerOnWalkable();
    this.cameras.main.shake(150, 0.003);
    this.showFloatingText(this.player.x, this.player.y - 50, "🔨 Область изменена");
  }

  // Размещает объекты рядом с игроком (place_objects)
  private applyAiObjects(objects: Array<{dx: number; dy: number; tile: string}>) {
    const charMap: Record<string, { tile: TileId; texture: string; tint?: number; biome: BiomeType }> = {
      "G": { tile: "grass", texture: "tile-grass",     biome: "default" },
      "W": { tile: "water", texture: "tile-water",     biome: "default" },
      "R": { tile: "rock",  texture: "tile-rock",      biome: "default" },
      "T": { tile: "tree",  texture: "tile-tree",      biome: "default" },
      "U": { tile: "ruins", texture: "tile-ruins",     biome: "default" },
      "S": { tile: "grass", texture: "tile-snow",      biome: "snow" },
      "I": { tile: "rock",  texture: "tile-rock",      tint: 0xcce5ff, biome: "snow" },
      "P": { tile: "tree",  texture: "tile-pine-snow", biome: "snow" },
      "M": { tile: "grass", texture: "tile-magma",     biome: "lava" },
      "V": { tile: "rock",  texture: "tile-volcanic",  biome: "lava" },
      "C": { tile: "tree",  texture: "tile-volcanic",  tint: 0x333333, biome: "lava" },
      "D": { tile: "grass", texture: "tile-sand",      biome: "desert" },
      "N": { tile: "rock",  texture: "tile-rock",      tint: 0xccbb99, biome: "desert" },
      "K": { tile: "tree",  texture: "tile-cactus",    biome: "desert" },
      // === ПРИРОДА РАСШИРЕННАЯ (без конфликтов с новыми объектами) ===
      "f": { tile: "tree",  texture: "tile-tree",      tint: 0x006600, biome: "default" }, // тёмный лес
      "h": { tile: "grass", texture: "tile-grass",     tint: 0xcc9933, biome: "default" }, // осенняя трава
      "j": { tile: "ruins", texture: "tile-ruins",     tint: 0x55aa55, biome: "default" }, // заросшие руины
      "k": { tile: "tree",  texture: "tile-pine-snow", biome: "snow"   },                  // ель
      "m": { tile: "grass", texture: "tile-grass",     tint: 0xddff99, biome: "default" }, // цветочная поляна
      "n": { tile: "rock",  texture: "tile-rock",      tint: 0xff9966, biome: "default" }, // кирпич
      "s": { tile: "rock",  texture: "tile-volcanic",  tint: 0xff6600, biome: "lava"    }, // раскалённый камень
      "t": { tile: "grass", texture: "tile-magma",     tint: 0xff2200, biome: "lava"    }, // лавовый поток
      "u": { tile: "grass", texture: "tile-snow",      tint: 0xeeffff, biome: "snow"    }, // чистый снег
      "v": { tile: "rock",  texture: "tile-rock",      tint: 0xaaddff, biome: "snow"    }, // ледяная глыба
      "w": { tile: "water", texture: "tile-water",     tint: 0x88ccff, biome: "snow"    }, // замёрзшее озеро
      "x": { tile: "ruins", texture: "tile-ruins",     tint: 0xffcc00, biome: "default" }, // золото/сокровище
      // === НОВЫЕ ОБЪЕКТЫ ===
      "i": { tile: "ice",            texture: "tile-ice",           biome: "snow"    },
      "c": { tile: "crystal",        texture: "tile-crystal",       biome: "default" },
      "y": { tile: "mythic_rock",    texture: "tile-mythic-rock",   biome: "default" },
      "z": { tile: "snowball",       texture: "tile-snowball",      biome: "snow"    },
      "l": { tile: "frozen_lake",    texture: "tile-frozen-lake",   biome: "snow"    },
      "q": { tile: "quartz",         texture: "tile-quartz",        biome: "default" },
      "b": { tile: "board",          texture: "tile-board",         biome: "default" },
      "a": { tile: "glass",          texture: "tile-glass",         biome: "default" },
      "e": { tile: "concrete",       texture: "tile-concrete",      biome: "default" },
      "p": { tile: "plant",          texture: "tile-plant",         biome: "default" },
      "g": { tile: "glowing_mushroom", texture: "tile-glow-mushroom", biome: "default" },
      "r": { tile: "ash",            texture: "tile-ash",           biome: "default" },
      "o": { tile: "coral",          texture: "tile-coral",         biome: "default" },
      // === ГОРОД / ЦИВИЛИЗАЦИЯ ===
      "1": { tile: "rock",  texture: "tile-rock",      tint: 0x8b7355, biome: "default" }, // дом/здание
      "3": { tile: "rock",  texture: "tile-rock",      tint: 0xdddddd, biome: "default" }, // стена/забор
      "4": { tile: "ruins", texture: "tile-ruins",     tint: 0xff8800, biome: "default" }, // огонь/костёр
      "5": { tile: "rock",  texture: "tile-rock",      tint: 0x4444ff, biome: "default" }, // вода в колодце/фонтан
      "6": { tile: "ruins", texture: "tile-ruins",     tint: 0xaaaaaa, biome: "default" }, // могила/надгробие
      "7": { tile: "tree",  texture: "tile-tree",      tint: 0xff4444, biome: "default" }, // красное дерево/клён
      "8": { tile: "tree",  texture: "tile-tree",      tint: 0xffbb00, biome: "default" }, // золотое дерево/осень
      "9": { tile: "grass", texture: "tile-grass",     tint: 0x5599ff, biome: "default" }, // вода/ручей
      "0": { tile: "rock",  texture: "tile-rock",      tint: 0x222222, biome: "default" }, // тёмный камень/уголь
    };

    // Словарь русских названий объектов для AI → символ
    // (AI может прислать русское название, конвертируем в символ)
    const nameToTile: Record<string, string> = {
      дом: "1", здание: "1", дорога: "2", асфальт: "2", забор: "3",
      стена: "3", костёр: "4", огонь: "4", фонтан: "5", колодец: "Y",
      могила: "6", надгробие: "6", клён: "7", осина: "8",
      ручей: "9", уголь: "0", берёза: "g", ель: "k", пальма: "q",
      цветы: "p", сакура: "p", поляна: "m", артефакт: "o", золото: "x",
      сокровище: "x", лёд: "i", лава: "t", пепел: "r", гриб: "J",
      палатка: "Q", бочка: "O", сундук: "Z", куст: "X",
      трава: "G", камень: "R", дерево: "T", вода: "W", руины: "U",
      снег: "S", кактус: "K", магма: "M", песок: "D",
      // Новые объекты
      "мифическая трава": "Y", "мифтрава": "Y",
      "мифический камень": "y", "мифкамень": "y",
      кристалл: "c", "снежный комок": "z", снежком: "z",
      "замёрзшее озеро": "l", "замерзшее озеро": "l",
      кварц: "q", доска: "b", стекло: "a", бетон: "e",
      растение: "p", "светящийся гриб": "g", коралл: "o",
      "мифическое дерево": "A", "мифдерево": "A",
    };

    const px = Math.floor(this.player.x / TILE_SIZE);
    const py = Math.floor(this.player.y / TILE_SIZE);

    for (const obj of objects) {
      const tx = px + obj.dx;
      const ty = py + obj.dy;
      if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) continue;
      // Поддержка русских названий объектов
      const tileKey = nameToTile[obj.tile?.toLowerCase?.()] ?? obj.tile;
      const def = charMap[tileKey] ?? charMap["R"]!;
      const idx = ty * MAP_W + tx;
      const sprite = this.tileSprites[idx];
      if (!sprite) continue;
      this.tiles[ty][tx] = def.tile;
      sprite.setTexture(def.texture);
      sprite.setAlpha(this.tileAlpha(def.tile));
      sprite.setScale(1);
      if (def.tint !== undefined) sprite.setTint(def.tint);
      else sprite.clearTint();
      sprite.setData("biome", def.biome);
    }

    this.cameras.main.shake(100, 0.002);
    this.showFloatingText(this.player.x, this.player.y - 50, "📦 Объекты размещены!");
  }

  // Установка времени суток (день/ночь)
  public setTimeOfDay(time: TimeOfDay) {
    this.currentTimeOfDay = time;
    if (!this.dayNightOverlay) return;

    if (this.timeOfDayTransitionTween) {
      this.timeOfDayTransitionTween.stop();
    }

    const configs: Record<TimeOfDay, { color: number; alpha: number; label: string }> = {
      day:   { color: 0xffffff, alpha: 0,    label: "☀️ День" },
      dusk:  { color: 0xff8800, alpha: 0.30, label: "🌅 Закат" },
      night: { color: 0x000033, alpha: 0.72, label: "🌙 Ночь" },
      dawn:  { color: 0xff6644, alpha: 0.22, label: "🌄 Рассвет" },
    };

    const cfg = configs[time];
    this.dayNightOverlay.setFillStyle(cfg.color);

    this.timeOfDayTransitionTween = this.tweens.add({
      targets: this.dayNightOverlay,
      alpha: cfg.alpha,
      duration: 2000,
      ease: "Sine.easeInOut",
      onComplete: () => {
        this.showFloatingText(this.player.x, this.player.y - 60, cfg.label);
      },
    });
  }

  // Строительство структуры (замок, башня, дом и т.д.)
  public buildStructure(type: string, startX: number, startY: number, width: number, height: number) {
    const t = type.toLowerCase();

    type StructureDef = { tile: TileId; texture: string; tint?: number };

    const wallTile: StructureDef = t.includes("стекл") ? { tile: "glass",    texture: "tile-glass"    }
      : t.includes("бетон")  ? { tile: "concrete", texture: "tile-concrete" }
      : t.includes("лёд")    ? { tile: "ice",      texture: "tile-ice"      }
      : t.includes("мифич")  ? { tile: "mythic_rock", texture: "tile-mythic-rock" }
      :                         { tile: "rock",     texture: "tile-rock"     };

    const floorTile: StructureDef = t.includes("бетон") ? { tile: "concrete", texture: "tile-concrete" }
      : t.includes("доск")   ? { tile: "board",    texture: "tile-board"    }
      :                         { tile: "grass",    texture: "tile-grass"    };

    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        const tx = startX + dx;
        const ty = startY + dy;
        if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) continue;

        const isWall = dy === 0 || dy === height - 1 || dx === 0 || dx === width - 1;
        const def: StructureDef = isWall ? wallTile : floorTile;

        const idx = ty * MAP_W + tx;
        const sprite = this.tileSprites[idx];
        if (!sprite) continue;

        this.tiles[ty][tx] = def.tile;
        sprite.setTexture(def.texture);
        sprite.setAlpha(this.tileAlpha(def.tile));
        sprite.setScale(1);
        if (def.tint !== undefined) sprite.setTint(def.tint);
        else sprite.clearTint();
        sprite.setData("biome", "default");
      }
    }

    if (t.includes("замок") || t.includes("castle")) {
      const corners = [
        [startX, startY], [startX + width - 1, startY],
        [startX, startY + height - 1], [startX + width - 1, startY + height - 1]
      ];
      for (const [cx, cy] of corners) {
        if (cx >= 0 && cx < MAP_W && cy >= 0 && cy < MAP_H) {
          const cidx = cy * MAP_W + cx;
          this.tiles[cy][cx] = "ruins";
          this.tileSprites[cidx]?.setTexture("tile-ruins");
          this.tileSprites[cidx]?.clearTint();
        }
      }
    }

    this.repositionPlayerOnWalkable();
    this.cameras.main.shake(200, 0.005);
    this.showFloatingText(
      (startX + Math.floor(width / 2)) * TILE_SIZE,
      (startY - 1) * TILE_SIZE,
      `🏗️ Построено!`
    );
  }

  private repositionPlayerOnWalkable() {
    const px = Math.floor(this.player.x / TILE_SIZE);
    const py = Math.floor(this.player.y / TILE_SIZE);

    // ЖЕСТКАЯ ЗАЧИСТКА: Пройдись в радиусе 3х3 вокруг игрока
    // Если тайл непроходимый — принудительно ставим траву
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
        
        if (!this.isWalkable(nx, ny)) {
          // Принудительно ставим базовый пол (траву)
          this.tiles[ny][nx] = "grass";
          const idx = ny * MAP_W + nx;
          const sprite = this.tileSprites[idx];
          if (sprite) {
            sprite.setTexture("tile-grass");
            sprite.clearTint();
            sprite.setAlpha(this.tileAlpha("grass"));
            sprite.setScale(1);
            sprite.setData('biome', 'default');
            sprite.setData('type', 'default');
            sprite.setData('itemKey', null);
          }
        }
      }
    }

    // ИДЕАЛЬНЫЙ СБРОС ФИЗИКИ
    const wx = px * TILE_SIZE + TILE_SIZE / 2;
    const wy = py * TILE_SIZE + TILE_SIZE / 2;
    
    // Останавливаем физику
    if (this.playerBody) {
      this.playerBody.stop();
      this.playerBody.setVelocity(0, 0);
      this.playerBody.reset(wx, wy);
    }
    
    // Перемещаем игрока в центр расчищенного тайла
    this.player.setPosition(wx, wy);
    this.playerGlow.setPosition(wx, wy);

    // ПЕРЕЗАГРУЗКА ВВОДА (Критично!): Чтобы WASD снова работал после ввода текста
    if (this.input.keyboard) {
      this.input.keyboard.enabled = true;
      this.input.keyboard.enableGlobalCapture();
      this.input.keyboard.resetKeys();
    }
  }
  
  // Принудительный сброс клавиш извне (из React)
  public resetKeyboard() {
    if (this.input.keyboard) {
      this.input.keyboard.enabled = true;
      this.input.keyboard.enableGlobalCapture();
      this.input.keyboard.resetKeys();
    }
  }

  private isWalkable(tx: number, ty: number): boolean {
    if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return false;
    const tile = this.tiles[ty][tx];
    return tile === "grass" || tile === "mythic_grass" || tile === "ice"
      || tile === "snowball" || tile === "ash" || tile === "board";
  }

  // ================================================================
  // НОВЫЕ МЕТОДЫ ДЛЯ УЛУЧШЕННОЙ ОБРАБОТКИ КОМАНД AI
  // ================================================================

  // Продвинутое терраформирование (гора, река, дорога, озеро и т.д.)
  public applyTerrain(data: any) {
    const shape = data.shape || "mountain";
    const biome = data.biome || this.currentBiome;
    const cx = data.center_x !== undefined ? data.center_x : Math.floor(this.player.x / TILE_SIZE);
    const cy = data.center_y !== undefined ? data.center_y : Math.floor(this.player.y / TILE_SIZE);
    const radius = data.radius || 10;
    const rng = () => Math.random();

    switch (shape) {
      case "mountain": {
        // Создаём возвышенность из камней
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > radius) continue;
            const tx = cx + dx;
            const ty = cy + dy;
            if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) continue;
            // Чем ближе к центру, тем выше вероятность камня
            const chance = 1 - (dist / radius);
            if (rng() < chance * 0.9) {
              this.tiles[ty][tx] = "rock";
              this.updateTileSprite(tx, ty, "rock", biome);
            } else if (rng() < 0.5) {
              this.tiles[ty][tx] = "tree";
              this.updateTileSprite(tx, ty, "tree", biome);
            }
          }
        }
        this.showFloatingText(cx * TILE_SIZE, cy * TILE_SIZE - 32, "⛰️ Гора создана!");
        break;
      }
      case "river": {
        // Создаём извилистую реку
        const riverLen = radius * 3;
        let rx = cx, ry = cy;
        let dirX = rng() > 0.5 ? 1 : -1;
        let dirY = rng() > 0.5 ? 1 : -1;
        for (let i = 0; i < riverLen; i++) {
          if (rx >= 0 && rx < MAP_W && ry >= 0 && ry < MAP_H) {
            this.tiles[ry][rx] = "water";
            this.updateTileSprite(rx, ry, "water", biome);
            // Делаем русло шире
            if (rng() > 0.7) {
              const wx = rx + (rng() > 0.5 ? 1 : -1);
              const wy = ry + (rng() > 0.5 ? 0 : 1);
              if (wx >= 0 && wx < MAP_W && wy >= 0 && wy < MAP_H) {
                this.tiles[wy][wx] = "water";
                this.updateTileSprite(wx, wy, "water", biome);
              }
            }
          }
          // Меняем направление случайным образом
          if (rng() > 0.75) { dirX = rng() > 0.5 ? 1 : -1; }
          if (rng() > 0.75) { dirY = rng() > 0.5 ? 1 : -1; }
          rx += dirX;
          ry += dirY;
          // Не даём выйти за границы
          rx = Math.max(1, Math.min(MAP_W - 2, rx));
          ry = Math.max(1, Math.min(MAP_H - 2, ry));
        }
        this.showFloatingText(cx * TILE_SIZE, cy * TILE_SIZE - 32, "🌊 Река создана!");
        break;
      }
      case "lake": {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            const noise = rng() * 2;
            if (dist + noise <= radius) {
              const tx = cx + dx;
              const ty = cy + dy;
              if (tx >= 1 && tx < MAP_W - 1 && ty >= 1 && ty < MAP_H - 1) {
                this.tiles[ty][tx] = "water";
                this.updateTileSprite(tx, ty, "water", biome);
              }
            }
          }
        }
        this.showFloatingText(cx * TILE_SIZE, cy * TILE_SIZE - 32, "🏖️ Озеро создано!");
        break;
      }
      case "road": {
        // Прокладываем дорогу по горизонтали
        for (let x = Math.max(0, cx - radius * 2); x <= Math.min(MAP_W - 1, cx + radius * 2); x++) {
          if (this.tiles[cy][x] !== "water") {
            this.tiles[cy][x] = "grass";
            this.updateTileSprite(x, cy, "grass", biome);
          }
          // Дорожные столбы
          if (Math.abs(x - cx) % 3 === 0 && rng() > 0.5) {
            const px = x;
            const py = cy - 1;
            if (py >= 0 && py < MAP_H && this.tiles[py][px] !== "water") {
              this.tiles[py][px] = "rock";
              this.updateTileSprite(px, py, "rock", biome);
            }
          }
        }
        this.showFloatingText(cx * TILE_SIZE, cy * TILE_SIZE - 32, "🛣️ Дорога проложена!");
        break;
      }
      case "valley": {
        // Долина — углубление с травой и цветами
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= radius) {
              const tx = cx + dx;
              const ty = cy + dy;
              if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) {
                this.tiles[ty][tx] = "grass";
                this.updateTileSprite(tx, ty, "grass", biome);
                // Добавляем цветы/растения
                if (rng() > 0.85 && dist > radius * 0.3) {
                  this.tiles[ty][tx] = "plant";
                  this.updateTileSprite(tx, ty, "plant", biome);
                }
              }
            }
          }
        }
        this.showFloatingText(cx * TILE_SIZE, cy * TILE_SIZE - 32, "🏞️ Долина создана!");
        break;
      }
      default: {
        // Холм/по умолчанию — мягкое возвышение
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= radius) {
              const tx = cx + dx;
              const ty = cy + dy;
              if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) {
                const chance = 1 - (dist / radius);
                if (chance > 0.5 && this.tiles[ty][tx] !== "water") {
                  this.tiles[ty][tx] = "rock";
                  this.updateTileSprite(tx, ty, "rock", biome);
                }
              }
            }
          }
        }
        this.showFloatingText(cx * TILE_SIZE, cy * TILE_SIZE - 32, `🏔️ ${shape} создан!`);
        break;
      }
    }

    this.repositionPlayerOnWalkable();
    this.cameras.main.shake(300, 0.005);
  }

  // Региональное изменение (прямоугольник)
  public applyModifyRegion(x1: number, y1: number, x2: number, y2: number, tile_from?: string, tile_to?: string) {
    const charMap: Record<string, string> = {
      "G": "grass", "W": "water", "R": "rock", "T": "tree", "U": "ruins",
      "S": "snow", "D": "sand", "M": "magma", "P": "pine", "K": "cactus",
      "i": "ice", "c": "crystal", "y": "mythic_rock", "o": "coral",
      "l": "frozen_lake", "q": "quartz", "b": "board", "a": "glass",
      "e": "concrete", "p": "plant", "g": "glowing_mushroom", "r": "ash", "z": "snowball",
    };

    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(MAP_W - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(MAP_H - 1, Math.max(y1, y2));
    const fromTile = tile_from ? charMap[tile_from] || "grass" : null;
    const toTile = tile_to ? charMap[tile_to] || "grass" : "grass";

    let count = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (fromTile === null || this.tiles[y][x] === fromTile) {
          this.tiles[y][x] = toTile as TileId;
          this.updateTileSprite(x, y, toTile, this.currentBiome);
          count++;
        }
      }
    }
    this.showFloatingText(
      ((minX + maxX) / 2) * TILE_SIZE,
      minY * TILE_SIZE - 20,
      `📐 Изменено: ${count} тайлов`
    );
    this.repositionPlayerOnWalkable();
  }

  // Заполнение области одним типом
  public applyFillArea(x1: number, y1: number, x2: number, y2: number, tile: string) {
    this.applyModifyRegion(x1, y1, x2, y2, undefined, tile);
  }

  // Нанесение узора
  public applyPattern(type: string, tileA: string, tileB: string, x1?: number, y1?: number, x2?: number, y2?: number) {
    const charMap: Record<string, string> = {
      "G": "grass", "W": "water", "R": "rock", "T": "tree", "U": "ruins",
      "S": "snow", "D": "sand", "M": "magma", "P": "pine", "K": "cactus",
      "i": "ice", "c": "crystal", "y": "mythic_rock", "o": "coral",
      "l": "frozen_lake", "q": "quartz", "b": "board", "a": "glass",
      "e": "concrete", "p": "plant", "g": "glowing_mushroom", "r": "ash", "z": "snowball",
      "Y": "mythic_grass",
    };

    const tileAType = charMap[tileA] || "grass";
    const tileBType = charMap[tileB] || "rock";
    const minX = Math.max(0, x1 ?? 0);
    const maxX = Math.min(MAP_W - 1, x2 ?? MAP_W - 1);
    const minY = Math.max(0, y1 ?? 0);
    const maxY = Math.min(MAP_H - 1, y2 ?? MAP_H - 1);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let useA = false;
        switch (type) {
          case "checkerboard":
            useA = (x + y) % 2 === 0;
            break;
          case "stripes":
            useA = x % 2 === 0;
            break;
          case "rings": {
            const dist = Math.sqrt((x - (minX + maxX) / 2) ** 2 + (y - (minY + maxY) / 2) ** 2);
            useA = Math.floor(dist) % 2 === 0;
            break;
          }
          case "spiral": {
            const dx = x - (minX + maxX) / 2;
            const dy = y - (minY + maxY) / 2;
            const angle = Math.atan2(dy, dx);
            useA = Math.floor((angle / (Math.PI * 2)) * 10) % 2 === 0;
            break;
          }
          case "gradient": {
            const progress = (x - minX) / (maxX - minX || 1);
            useA = progress < 0.5;
            break;
          }
          default:
            useA = true;
        }
        const selectedTile = useA ? tileAType : tileBType;
        this.tiles[y][x] = selectedTile as TileId;
        this.updateTileSprite(x, y, selectedTile, this.currentBiome);
      }
    }
    this.repositionPlayerOnWalkable();
    this.cameras.main.shake(200, 0.004);
    this.showFloatingText(
      ((minX + maxX) / 2) * TILE_SIZE,
      minY * TILE_SIZE - 20,
      `🎨 Узор "${type}" нанесён!`
    );
  }

  // Кастомный набор тайлов (массив {x, y, tile})
  public applyCustomTileset(tiles: Array<{x: number; y: number; tile: string}>) {
    const charMap: Record<string, string> = {
      "G": "grass", "W": "water", "R": "rock", "T": "tree", "U": "ruins",
      "S": "snow", "D": "sand", "M": "magma", "P": "pine", "K": "cactus",
      "i": "ice", "c": "crystal", "y": "mythic_rock", "o": "coral",
      "l": "frozen_lake", "q": "quartz", "b": "board", "a": "glass",
      "e": "concrete", "p": "plant", "g": "glowing_mushroom", "r": "ash", "z": "snowball",
      "Y": "mythic_grass",
    };

    let count = 0;
    for (const tileData of tiles) {
      const { x, y, tile: tileChar } = tileData;
      if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) continue;
      const tileName = charMap[tileChar] || "grass";
      this.tiles[y][x] = tileName as TileId;
      this.updateTileSprite(x, y, tileName, this.currentBiome);
      count++;
    }
    this.showFloatingText(this.player.x, this.player.y - 40, `🎯 Размещено: ${count} объектов`);
    this.repositionPlayerOnWalkable();
  }

  // Смешивание биомов
  public applyBiomeBlend(primary: string, secondary: string, blendRadius?: number, centerX?: number, centerY?: number) {
    const biomeMap: Record<string, BiomeType> = {
      snow: "snow", lava: "lava", desert: "desert",
      forest: "default", default: "default", swamp: "default",
    };
    const primaryBiome = biomeMap[primary] || "default";
    const secondaryBiome = biomeMap[secondary] || "default";
    const radius = blendRadius || 15;
    const cx = centerX !== undefined ? centerX : Math.floor(MAP_W / 2);
    const cy = centerY !== undefined ? centerY : Math.floor(MAP_H / 2);

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const blendFactor = Math.max(0, Math.min(1, dist / radius));
        const targetBiome = blendFactor < 0.5 ? primaryBiome : secondaryBiome;

        if (targetBiome !== this.currentBiome) {
          const tile = this.tiles[y][x];
          if (targetBiome === "lava") this.applyLavaTile(x, y, tile, this.tileSprites[y * MAP_W + x]!, y * MAP_W + x);
          else if (targetBiome === "desert") this.applyDesertTile(x, y, tile, this.tileSprites[y * MAP_W + x]!, y * MAP_W + x);
          else if (targetBiome === "snow") this.applySnowTile(x, y, tile, this.tileSprites[y * MAP_W + x]!, y * MAP_W + x);
        }
      }
    }
    this.currentBiome = primaryBiome;
    this.showFloatingText(cx * TILE_SIZE, cy * TILE_SIZE - 40, `🎨 Смешивание: ${primary} → ${secondary}`);
    this.repositionPlayerOnWalkable();
    this.cameras.main.shake(300, 0.005);
  }

  // Утилита: обновление спрайта тайла по координатам
  private updateTileSprite(x: number, y: number, tileType: string, biome: BiomeType, extraTint?: number) {
    const idx = y * MAP_W + x;
    const sprite = this.tileSprites[idx];
    if (!sprite) return;

    // Определяем текстуру по типу и биому
    let texture = this.tileTexture(tileType as TileId);
    // Для биомных текстур переопределяем
    if (biome === "snow" && tileType === "grass") texture = "tile-snow";
    else if (biome === "snow" && tileType === "water") texture = "tile-water";
    else if (biome === "lava" && tileType === "grass") texture = "tile-magma";
    else if (biome === "desert" && tileType === "grass") texture = "tile-sand";
    else if (biome === "snow" && tileType === "tree") texture = "tile-pine-snow";
    else if (biome === "lava" && tileType === "tree") texture = "tile-volcanic";
    else if (biome === "desert" && tileType === "tree") texture = "tile-cactus";

    sprite.setTexture(texture);
    sprite.setAlpha(this.tileAlpha(tileType as TileId));
    if (extraTint !== undefined) {
      sprite.setTint(extraTint);
    } else {
      sprite.clearTint();
    }
    sprite.setData("biome", biome);
  }
}

export function createPhaserGame(cb: GameCallbacks): PhaserGameInstance {
  // Создаём конфигурацию игры
  // Берём размер контейнера в момент вызова (контейнер уже видим благодаря ResizeObserver)
  const width = cb.parent.clientWidth || window.innerWidth;
  const height = cb.parent.clientHeight || window.innerHeight;
 
  const gameConfig: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: cb.parent,
    width,
    height,
    backgroundColor: "#0a0a0a",
    physics: {
      default: "arcade",
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    scene: [LoadingScene, MainScene],
    pixelArt: false,
    antialias: true,
    render: {
      pixelArt: false,
      antialias: true,
    },
    // Масштабируем под контейнер автоматически
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  };
 
  const game = new Phaser.Game(gameConfig);
 
  let sceneInstance: MainScene | null = null;
 
  // 'ready' срабатывает после полной инициализации движка
  game.events.once("ready", () => {
    sceneInstance = game.scene.getScene("MainScene") as MainScene;
    if (sceneInstance) {
      sceneInstance.setCallbacks(cb);
    }
  });
 
  return {
    destroy: () => {
      game.destroy(true);
    },
    handle: {
      regenerateProceduralMap: () => {
        sceneInstance?.regenerateProceduralMap();
      },
      applyAiBiomeBackground: (url: string) => {
        return sceneInstance?.applyAiBiomeBackground(url) ?? Promise.resolve();
      },
      saveWorld: () => {
        sceneInstance?.saveWorld();
      },
    },
  };
}