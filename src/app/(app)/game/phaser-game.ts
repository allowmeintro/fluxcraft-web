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
  | "plant" | "glowing_mushroom" | "ash" | "coral" | "tnt" | "dirt";

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
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
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
  // === НОВОЕ: визуальные улучшения ===
  private waterShader: Phaser.GameObjects.Shader | null = null;
  private playerPointLight: any | null = null; // Phaser.GameObjects.PointLight (3.60+)
  private groundSprites: (Phaser.GameObjects.Image | null)[] = [];
  private obstacleTiles: Set<TileId> = new Set([
    "tree", "rock", "ruins", "mythic_rock", "quartz", "glass", "concrete",
    "coral", "crystal", "plant", "glowing_mushroom",
  ]);

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

    // Сбрасываем кэш текстур тайлов перед созданием
    // (на случай hot-reload или повторной инициализации сцены)
    const TILE_KEYS = [
      "tile-grass","tile-water","tile-rock","tile-tree","tile-ruins",
      "tile-ice","tile-snowball","tile-crystal","tile-quartz","tile-board",
      "tile-glass","tile-concrete","tile-plant","tile-glow-mushroom",
      "tile-ash","tile-coral","tile-tnt","tile-dirt","tile-mythic-grass","tile-mythic-rock",
      "tile-frozen-lake","tile-bog","tile-snow","tile-sand","tile-magma",
      "tile-volcanic","tile-cactus","tile-pine-snow","tile-mushroom",
      "tile-mythic-tree","player-robot","particle-orange","particle-debris",
    ];
    for (const key of TILE_KEYS) {
      if (this.textures.exists(key)) {
        this.textures.remove(key);
      }
    }

    // Создание текстур
    this.createTextures();

    // === НОВОЕ: Шейдер «Живая Вода» (анимированные волны через GLSL) ===
    this.createWaterShader();

    // Отрисовка тайлов
    this.renderTiles();

    // Создание игрока
    this.createPlayer();

    // === НОВОЕ: Bloom + динамический Point Light игрока ===
    this.setupBloomAndLighting();

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

    // Оверлей для дня/ночи
    this.dayNightOverlay = this.add.rectangle(
      0, 0,
      MAP_W * TILE_SIZE * 2, MAP_H * TILE_SIZE * 2,
      0x000033, 0
    ).setOrigin(0, 0).setDepth(50).setScrollFactor(0)
      .setPosition(-MAP_W * TILE_SIZE, -MAP_H * TILE_SIZE);
    // растягиваем на весь мир
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

    // Слушатель глобальной замены тайлов по типу (patch_tiles)
    window.addEventListener('ai-patch-tiles', (event: any) => {
      const { from, to } = event.detail as { from: string; to: string };
      this.applyPatchTiles(from, to);
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
      const { type, structure, x, y, width, height } = event.detail;
      this.buildStructure(type ?? structure ?? "house", x, y, width, height, structure);
    });

    // Слушатель прямой выдачи предметов в инвентарь (без размещения на карте)
    window.addEventListener('ai-give-items', (event: any) => {
      const { tile, amount } = event.detail as { tile: string; amount: number };
      const validTile = tile as TileId;
      if (validTile && validTile !== "empty" && validTile !== "water") {
        this.inventory[validTile] = (this.inventory[validTile] ?? 0) + amount;
        // Синхронизируем inventoryWithBiomes чтобы emitInventory() отобразил
        if (!this.inventoryWithBiomes[validTile]) {
          this.inventoryWithBiomes[validTile] = { id: validTile, type: "default", tint: undefined, scale: 1, count: 0 };
        }
        this.inventoryWithBiomes[validTile].count += amount;
        this.emitInventory();
        this.showFloatingText(this.player.x, this.player.y - 50, `+${amount} ${tile}`);
        gameEvents.emit('item-given', { tile: validTile, amount });
      }
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
          gameEvents.emit('player-moved', { x: this.player.x, y: this.player.y, tx: px, ty: py });
        }
      },
    });

    // Сообщаем что сцена готова
    gameEvents.emit('game-ready', {});
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

    // Контейнер позиции игрока (нужен для камеры и частиц)
    this.player.setDepth(11);
    this.playerGlow = this.add.container(this.player.x, this.player.y);
    this.playerGlow.setDepth(10);
    this.playerGlow.setSize(TILE_SIZE, TILE_SIZE);
    // Свечение убрано

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
<<<<<<< HEAD
    if (dist > TILE_SIZE * 4) return;
=======
    if (dist > TILE_SIZE * 3) return;
>>>>>>> b68369ca310951aa4862415938f1c2680dc434bf

    if (this.shiftDown || this.mouseButton === 1) {
      // Shift+ЛКМ или ПКМ - поставить тайл
      this.placeTile(tx, ty);
    } else {
      // ЛКМ - сломать тайл
      // Игнорируем tint - проверяем только базовый тип тайла
      // Вода и пустые тайлы не ломаются
      const notBreakable: TileId[] = ["empty", "water", "frozen_lake", "mythic_grass"];
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
    this.inventoryWithBiomes = {};
    this.emitInventory();
    this.generateBiome(this.biomeSeed);
    this.renderTiles(true);
    gameEvents.emit('map-regenerated', {});
    
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
    gameEvents.emit('world-saved', {});
    
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
    // Детерминированный RNG для стабильных текстур (не Math.random()!)
    let _seed = 0x4a3f9e1b;
    const tr = () => {
      _seed ^= _seed << 13; _seed ^= _seed >> 17; _seed ^= _seed << 5;
      return ((_seed >>> 0) / 0xffffffff);
    };

    // Базовый помощник — заливка + декор + рамка
    const makeTile = (key: string, color: number, deco?: (g: Phaser.GameObjects.Graphics) => void) => {
      const g = this.add.graphics();
      g.fillStyle(color, 1);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      if (deco) deco(g);
      g.lineStyle(1, 0x0a0a0a, 0.35);
      g.strokeRect(0, 0, TILE_SIZE, TILE_SIZE);
      g.generateTexture(key, TILE_SIZE, TILE_SIZE);
      g.destroy();
    };

    // ── ТРАВА — сочная изумрудная с травинками ──────────────────────────────
    makeTile("tile-grass", 0x1a7a45, (g) => {
      // Тёмные пятна почвы
      g.fillStyle(0x0e5c32, 0.5);
      const grassPos = [[3,5],[9,2],[17,7],[25,3],[6,14],[14,11],[22,15],[28,9],[2,22],[11,19],[20,24],[27,18],[5,27],[16,29],[24,26]];
      for (const [x,y] of grassPos) { g.fillRect(x, y, 2, 4); }
      // Светлые блики
      g.fillStyle(0x2ec06a, 0.25);
      const blikPos = [[7,8],[19,4],[25,20],[4,25]];
      for (const [x,y] of blikPos) { g.fillCircle(x, y, 2.5); }
      // Тень у краев
      g.fillStyle(0x0a4a28, 0.2);
      g.fillRect(0, 0, TILE_SIZE, 3);
      g.fillRect(0, 0, 3, TILE_SIZE);
    });

    // ── ВОДА — глубокий синий с волнами и бликами ───────────────────────────
    {
      const g = this.add.graphics();
      g.fillStyle(0x0d4f7c, 1);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      g.fillStyle(0x1565a0, 0.5);
      g.fillRect(0, 4, TILE_SIZE, TILE_SIZE - 4);
      // Волны
      g.lineStyle(2, 0x4fc3f7, 0.7);
      g.beginPath(); g.moveTo(2,8); g.lineTo(8,5); g.lineTo(14,8); g.lineTo(20,5); g.lineTo(26,8); g.lineTo(30,6); g.strokePath();
      g.beginPath(); g.moveTo(0,16); g.lineTo(6,13); g.lineTo(12,16); g.lineTo(18,13); g.lineTo(24,16); g.lineTo(30,13); g.strokePath();
      g.beginPath(); g.moveTo(2,24); g.lineTo(8,21); g.lineTo(14,24); g.lineTo(20,21); g.lineTo(26,24); g.lineTo(30,22); g.strokePath();
      // Блики
      g.fillStyle(0x81d4fa, 0.6);
      g.fillCircle(6,10,1.5); g.fillCircle(20,7,1); g.fillCircle(26,18,1.5); g.fillCircle(10,25,1); g.fillCircle(18,20,1.5);
      g.lineStyle(1, 0x042d50, 0.8);
      g.strokeRect(0, 0, TILE_SIZE, TILE_SIZE);
      g.generateTexture("tile-water", TILE_SIZE, TILE_SIZE);
      g.destroy();
    }

    // ── КАМЕНЬ — тёмно-серый с рельефом и трещинами ─────────────────────────
    makeTile("tile-rock", 0x3a3f44, (g) => {
      // Базовый рельеф
      g.fillStyle(0x4a5259, 0.6);
      const rockBumps = [[5,4,4],[12,8,5],[22,5,3],[8,18,6],[20,20,4],[27,14,3],[14,25,5],[3,26,3]];
      for (const [x,y,r] of rockBumps) g.fillCircle(x, y, r);
      // Светлый блик сверху-слева
      g.fillStyle(0x5e6870, 0.5);
      g.fillTriangle(0,0,14,0,0,14);
      // Трещины
      g.lineStyle(1, 0x1e2326, 0.65);
      g.lineBetween(6,4,18,14); g.lineBetween(14,18,26,28); g.lineBetween(20,6,24,22);
      // Тёмная сторона
      g.fillStyle(0x1c2024, 0.3);
      g.fillTriangle(TILE_SIZE,TILE_SIZE,TILE_SIZE-10,TILE_SIZE,TILE_SIZE,TILE_SIZE-10);
    });

    // ── ДЕРЕВО — стилизованная ель с тенью ──────────────────────────────────
    {
      const g = this.add.graphics();
      // Фон (трава под деревом)
      g.fillStyle(0x1a7a45, 1);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      // Тень
      g.fillStyle(0x0a0a0a, 0.28);
      g.fillEllipse(17, 29, 18, 7);
      // Ствол
      g.fillStyle(0x6b4226, 1);
      g.fillRect(13, 22, 6, 9);
      g.fillStyle(0x4a2e1a, 0.5);
      g.fillRect(13, 22, 2, 9);
      // Нижний ярус кроны
      g.fillStyle(0x1b5e20, 1);
      g.fillTriangle(16, 6, 3, 24, 29, 24);
      // Средний ярус
      g.fillStyle(0x256b2c, 1);
      g.fillTriangle(16, 2, 7, 18, 25, 18);
      // Верхушка
      g.fillStyle(0x2e8035, 1);
      g.fillTriangle(16, 0, 10, 12, 22, 12);
      // Блик
      g.fillStyle(0x4aaa55, 0.3);
      g.fillTriangle(16, 2, 10, 12, 16, 12);
      g.generateTexture("tile-tree", TILE_SIZE, TILE_SIZE);
      g.destroy();
    }

    // ── РУИНЫ — серые обломки с колоннами ───────────────────────────────────
    {
      const g = this.add.graphics();
      g.fillStyle(0x353b40, 1);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      // Основание
      g.fillStyle(0x4a5568, 1);
      g.fillRect(5, 16, 22, 13);
      // Колонны
      g.fillStyle(0x5a6a82, 1);
      g.fillRect(7, 8, 5, 10); g.fillRect(20, 10, 5, 8);
      // Капители
      g.fillStyle(0x6a7a92, 1);
      g.fillRect(6, 7, 7, 3); g.fillRect(19, 9, 7, 3);
      // Трещины и обломки
      g.fillStyle(0x2a3038, 0.7);
      g.fillCircle(14, 24, 3); g.fillCircle(23, 26, 2); g.fillCircle(8, 27, 2.5);
      g.lineStyle(1, 0x1e2428, 0.5);
      g.lineBetween(7,8,11,14); g.lineBetween(20,10,22,18);
      g.generateTexture("tile-ruins", TILE_SIZE, TILE_SIZE);
      g.destroy();
    }

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
    debrisParticle.fillStyle(0x8B737355, 1);
    debrisParticle.fillRect(0, 0, 4, 4);
    debrisParticle.generateTexture("particle-debris", 4, 4);
    debrisParticle.destroy();

    // ==========================================
    // ТЕКСТУРЫ ДЛЯ ТЕРРАФОРМИРОВАНИЯ
    // ==========================================

    // Песок (для пустынного биома)
    makeTile("tile-sand", 0xdeb887, (g) => {
      g.fillStyle(0xc4a472, 0.4);
      const sandDots = [[4,3,1.5],[10,7,2],[18,4,1],[25,8,1.5],[7,14,1.5],[14,18,2],[22,12,1],[28,16,1.5],[3,22,1],[12,25,1.5],[20,20,2],[27,26,1],[6,28,1.5],[16,28,1],[24,24,1.5]];
      for (const [x,y,r] of sandDots) g.fillCircle(x, y, r);
      // Рябь
      g.lineStyle(1, 0xc4a060, 0.25);
      g.lineBetween(2,10,30,10); g.lineBetween(2,20,30,20);
    });

    // Снег (для снежного биома)
    makeTile("tile-snow", 0xeef4fb, (g) => {
      g.fillStyle(0xd6e8f4, 0.5);
      const snowDots = [[5,4,2.5],[13,7,1.5],[21,3,2],[28,9,1.5],[3,15,2],[10,19,2.5],[18,14,1.5],[26,20,2],[7,24,2],[15,27,1.5],[23,25,2.5],[29,28,1.5]];
      for (const [x,y,r] of snowDots) g.fillCircle(x, y, r);
      // Снежинки
      g.lineStyle(1, 0xffffff, 0.7);
      g.lineBetween(4,8,8,12); g.lineBetween(8,8,4,12);
      g.lineBetween(22,18,26,22); g.lineBetween(26,18,22,22);
    });

    // Вулканический камень (для лавового биома)
    makeTile("tile-volcanic", 0x1e1212, (g) => {
      g.fillStyle(0x2e1a1a, 0.7);
      const volBumps = [[5,5,3],[14,8,4],[23,4,3],[8,18,4],[20,16,3],[27,22,3],[12,26,3],[4,26,2]];
      for (const [x,y,r] of volBumps) g.fillCircle(x, y, r);
      // Трещины с лавой
      g.lineStyle(2, 0xff3300, 0.6);
      g.lineBetween(4,4,14,16); g.lineBetween(14,16,24,28); g.lineBetween(22,6,28,18);
      // Свечение лавы
      g.fillStyle(0xff5500, 0.2);
      g.fillCircle(14,16,4); g.fillCircle(22,6,3);
    });

    if (!this.textures.exists("tile-cactus")) {
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
    }

    if (!this.textures.exists("tile-pine-snow")) {
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
    }

    // Остатки магмы (для лавового биома)
    {
      const magmaResidue = this.add.graphics();
      magmaResidue.fillStyle(0x120808, 1);
      magmaResidue.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      // Лавовые пятна (фиксированные позиции)
      const lavaBlobs: [number,number,number][] = [[6,5,3],[16,4,2.5],[24,8,3],[10,14,2],[20,18,3],[4,22,2.5],[14,24,3],[26,20,2],[8,28,2],[22,28,2.5]];
      magmaResidue.fillStyle(0xff3300, 0.9);
      for (const [x,y,r] of lavaBlobs) magmaResidue.fillCircle(x, y, r);
      magmaResidue.fillStyle(0xff7700, 0.6);
      const glowBlobs: [number,number,number][] = [[6,5,1.5],[16,4,1],[24,8,1.5],[10,14,1],[20,18,1.5],[22,28,1]];
      for (const [x,y,r] of glowBlobs) magmaResidue.fillCircle(x, y, r);
      magmaResidue.generateTexture("tile-magma", TILE_SIZE, TILE_SIZE);
      magmaResidue.destroy();
    }

    // Гриб (для болотного биома)
    {
      const mushroom = this.add.graphics();
      mushroom.fillStyle(0x2a1e35, 1);
      mushroom.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      // Споры
      mushroom.fillStyle(0xffffff, 0.25);
      const spores: [number,number,number][] = [[4,5,1],[10,3,1.5],[20,6,1],[26,4,1.5],[2,14,1],[28,18,1]];
      for (const [x,y,r] of spores) mushroom.fillCircle(x, y, r);
      // Шляпка
      mushroom.fillStyle(0x8b1515, 1);
      mushroom.fillEllipse(16, 10, 22, 14);
      mushroom.fillStyle(0xcc1c1c, 1);
      mushroom.fillEllipse(16, 8, 18, 10);
      // Пятна
      mushroom.fillStyle(0xffffff, 0.85);
      mushroom.fillCircle(12, 7, 2); mushroom.fillCircle(20, 9, 1.5); mushroom.fillCircle(16, 5, 1);
      // Ножка
      mushroom.fillStyle(0xf0d8a0, 1);
      mushroom.fillRect(13, 14, 6, 14);
      mushroom.fillStyle(0xd4bc8c, 0.5);
      mushroom.fillRect(13, 14, 2, 14);
      mushroom.generateTexture("tile-mushroom", TILE_SIZE, TILE_SIZE);
      mushroom.destroy();
    }

    if (!this.textures.exists("tile-crystal")) {
      // Кристалл — непрозрачный, без дробных альф
      const crystal = this.add.graphics();
      crystal.fillStyle(0x0a0a2a, 1);
      crystal.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      crystal.fillStyle(0x3399ee, 1);        // тело кристалла
      crystal.fillTriangle(16, 2, 8, 20, 24, 20);
      crystal.fillStyle(0x55bbff, 1);        // верхний блик
      crystal.fillTriangle(16, 4, 10, 18, 22, 18);
      crystal.fillStyle(0xaaddff, 1);        // яркий блик
      crystal.fillTriangle(16, 5, 14, 12, 19, 12);
      crystal.fillStyle(0x2277cc, 1);        // основание
      crystal.fillTriangle(8, 20, 24, 20, 16, 30);
      crystal.lineStyle(1, 0x88ccff, 1);
      crystal.lineBetween(8, 20, 16, 2);
      crystal.lineBetween(16, 2, 24, 20);
      crystal.generateTexture("tile-crystal", TILE_SIZE, TILE_SIZE);
      crystal.destroy();
    }

    // Болото (тёмная вода)
    makeTile("tile-bog", 0x1a3318, (g) => {
      g.fillStyle(0x254a22, 0.5);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      g.fillStyle(0x356632, 0.3);
      const bogBlobs: [number,number,number][] = [[6,5,3],[18,8,4],[10,18,5],[24,22,3],[4,26,4]];
      for (const [x,y,r] of bogBlobs) g.fillCircle(x, y, r);
      // Пузыри болота
      g.lineStyle(1, 0x4a8840, 0.4);
      g.strokeCircle(8,14,2); g.strokeCircle(22,10,1.5); g.strokeCircle(16,26,2);
    });

    // ==========================================
    // НОВЫЕ ОБЪЕКТЫ
    // ==========================================

    // ЛЁД — полностью непрозрачный, без дробных альф
    makeTile("tile-ice", 0x88ccee, (g) => {
      // Второй слой чуть светлее — имитация блеска
      g.fillStyle(0xbbddf0, 1);
      g.fillRect(3, 3, 26, 26);
      // Трещины — чистые линии, alpha=1
      g.lineStyle(1, 0xffffff, 1);
      g.lineBetween(4, 10, 28, 10);
      g.lineBetween(4, 20, 28, 20);
      g.lineStyle(1, 0xd0eeff, 1);
      g.lineBetween(6, 4, 14, 16);
      g.lineBetween(18, 14, 26, 28);
      // Угловые блики — светлые треугольники, alpha=1
      g.fillStyle(0xe8f8ff, 1);
      g.fillTriangle(3, 3, 12, 3, 3, 12);
      g.fillTriangle(19, 19, 29, 29, 19, 29);
    });

    // МИФИЧЕСКАЯ ТРАВА — розово-фиолетовая светящаяся
    makeTile("tile-mythic-grass", 0x7722aa, (g) => {
      g.fillStyle(0x9933cc, 1);
      const mgPos = [[3,4],[9,2],[17,6],[25,3],[6,13],[14,10],[22,14],[28,8],[2,21],[11,18],[20,23],[27,17],[5,26],[16,28],[24,25]];
      for (const [x,y] of mgPos) { g.fillRect(x, y, 2, 5); }
      g.fillStyle(0xdd66ff, 1);
      const mgBlik: [number,number][] = [[7,7],[19,4],[25,19],[4,24]];
      for (const [x,y] of mgBlik) g.fillCircle(x, y, 2.5);
      g.fillStyle(0xbb44ee, 1);
      g.fillCircle(16, 16, 11);
    });

    // МИФИЧЕСКИЙ КАМЕНЬ — тёмно-фиолетовый с кристаллическими вкраплениями
    makeTile("tile-mythic-rock", 0x2a1040, (g) => {
      g.fillStyle(0x3a1a55, 1);
      const mrBumps: [number,number,number][] = [[5,5,3],[14,8,4],[22,4,3],[8,18,3],[20,20,4],[26,14,3],[12,26,3]];
      for (const [x,y,r] of mrBumps) g.fillCircle(x, y, r);
      g.fillStyle(0xcc33ff, 1);
      g.fillTriangle(8, 20, 14, 8, 20, 20);
      g.fillStyle(0xaa22ee, 1);
      g.fillTriangle(16, 22, 24, 12, 28, 22);
      g.lineStyle(1, 0xff99ff, 1);
      g.lineBetween(8,20,14,8); g.lineBetween(16,22,24,12);
    });

    // СНЕЖНЫЙ КОМОК — полностью непрозрачный, без дробных альф
    if (!this.textures.exists("tile-snowball")) {
      const snowball = this.add.graphics();
      snowball.fillStyle(0xcce8f8, 1);       // светло-голубой фон
      snowball.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      snowball.fillStyle(0xb0cfe0, 1);       // тёмный эллипс-тень под шаром
      snowball.fillEllipse(18, 25, 18, 5);
      snowball.fillStyle(0xffffff, 1);       // белый шар
      snowball.fillCircle(16, 16, 11);
      snowball.fillStyle(0xe8f4ff, 1);       // блик — чуть темнее белого
      snowball.fillCircle(11, 11, 4);
      snowball.lineStyle(2, 0x99bbcc, 1);    // контур
      snowball.strokeCircle(16, 16, 11);
      snowball.generateTexture("tile-snowball", TILE_SIZE, TILE_SIZE);
      snowball.destroy();
    }

    // ЗАМЁРЗШЕЕ ОЗЕРО — непрозрачный, без дробных альф
    makeTile("tile-frozen-lake", 0x77bbee, (g) => {
      g.fillStyle(0x99ccee, 1);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      g.fillStyle(0xbbddff, 1);
      g.fillEllipse(16, 16, 22, 12);
      g.lineStyle(1, 0xffffff, 1);
      g.lineBetween(4, 8, 16, 14);
      g.lineBetween(16, 14, 28, 6);
      g.lineBetween(8, 20, 20, 26);
      g.fillStyle(0xddeeff, 1);
      g.fillEllipse(12, 12, 8, 5);
    });

    if (!this.textures.exists("tile-quartz")) {
      // КВАРЦ — белый с розовым отливом, без дробных альф
      const quartz = this.add.graphics();
      quartz.fillStyle(0xfff0f8, 1);
      quartz.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      quartz.fillStyle(0xffccee, 1);
      quartz.fillTriangle(16, 2, 6, 18, 26, 18);
      quartz.fillStyle(0xffeef8, 1);
      quartz.fillTriangle(16, 4, 10, 14, 22, 14);
      quartz.fillStyle(0xffaadd, 1);
      quartz.fillTriangle(6, 18, 26, 18, 16, 30);
      quartz.lineStyle(1, 0xff88cc, 1);
      quartz.lineBetween(6, 18, 16, 2);
      quartz.lineBetween(16, 2, 26, 18);
      quartz.generateTexture("tile-quartz", TILE_SIZE, TILE_SIZE);
      quartz.destroy();
    }

    // ДОСКА — деревянные планки
    makeTile("tile-board", 0x8b5e3c, (g) => {
      const grainOffsets = [4, 12, 20, 6];
      for (let i = 0; i < 4; i++) {
        g.fillStyle(0xa06840, 1);
        g.fillRect(0, i * 8, TILE_SIZE, 7);
        g.lineStyle(1, 0x5a3820, 0.5);
        g.lineBetween(0, i*8+7, TILE_SIZE, i*8+7);
        // волокна (детерминированные)
        g.lineStyle(1, 0x7a4a28, 0.25);
        const gx = grainOffsets[i];
        g.lineBetween(gx, i*8+1, gx+10, i*8+6);
      }
    });

    // СТЕКЛО — голубой с отражением, без дробных альф
    makeTile("tile-glass", 0x99ccee, (g) => {
      g.fillStyle(0xbbd8ee, 1);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      g.fillStyle(0xddeeff, 1);
      g.fillTriangle(2, 2, 14, 2, 2, 14);
      g.fillStyle(0xeef6ff, 1);
      g.fillTriangle(18, 2, 30, 2, 30, 14);
      g.lineStyle(1, 0x77aacc, 1);
      g.strokeRect(1, 1, TILE_SIZE-2, TILE_SIZE-2);
      g.lineStyle(1, 0xaaccee, 1);
      g.lineBetween(0, 0, TILE_SIZE, TILE_SIZE);
    });

    // БЕТОН — серый однородный, без дробных альф
    makeTile("tile-concrete", 0x7a7a7a, (g) => {
      g.fillStyle(0x909090, 1);
      const concDots: [number,number,number][] = [[5,5,2],[14,4,1.5],[22,7,2.5],[8,15,2],[18,18,1.5],[26,12,2],[4,24,1.5],[12,27,2],[24,25,2.5]];
      for (const [x,y,r] of concDots) g.fillCircle(x, y, r);
      g.lineStyle(1, 0x555555, 1);
      g.lineBetween(0, 16, 32, 16); g.lineBetween(16, 0, 16, 16);
      g.lineBetween(0, 16, 0, 32); g.lineBetween(16, 16, 16, 32);
    });

    if (!this.textures.exists("tile-plant")) {
      // РАСТЕНИЕ — небольшой куст, без дробных альф
      const plant = this.add.graphics();
      plant.fillStyle(0x0a6030, 1);
      plant.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      plant.fillStyle(0x0d8040, 1);
      plant.fillEllipse(16, 20, 24, 16);
      plant.fillStyle(0x10a050, 1);
      plant.fillEllipse(10, 14, 14, 12);
      plant.fillEllipse(22, 14, 14, 12);
      plant.fillStyle(0x18c060, 1);
      plant.fillEllipse(16, 10, 12, 10);
      plant.fillStyle(0x5d4037, 1);
      plant.fillRect(14, 24, 4, 6);
      plant.generateTexture("tile-plant", TILE_SIZE, TILE_SIZE);
      plant.destroy();
    }

    if (!this.textures.exists("tile-glow-mushroom")) {
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
    }

    // ПЕПЕЛ — тёмно-серый
    makeTile("tile-ash", 0x2e2e2e, (g) => {
      g.fillStyle(0x404040, 0.55);
      const ashDots: [number,number,number][] = [[4,4,1.5],[11,3,1],[19,6,1.5],[26,4,1],[7,11,1.5],[14,14,1],[22,10,1.5],[28,15,1],[3,19,1],[10,22,1.5],[17,18,1],[25,21,1.5],[5,27,1],[13,28,1.5],[21,26,1],[28,28,1.5]];
      for (const [x,y,r] of ashDots) g.fillCircle(x, y, r);
      g.fillStyle(0x777777, 0.18);
      const ashLight: [number,number][] = [[8,8],[20,12],[14,22],[26,26]];
      for (const [x,y] of ashLight) g.fillCircle(x, y, 1.5);
    });

    // ГРЯЗЬ — тёмно-коричневая вытоптанная земля
    makeTile("tile-dirt", 0x4a3520, (g) => {
      // Неровные пятна разной тёмности
      g.fillStyle(0x3a2810, 1);
      const darkMud: [number,number,number][] = [[4,5,3],[14,3,2.5],[24,7,3],[8,16,4],[20,14,3],[27,20,2.5],[5,24,3],[15,27,2],[25,25,3]];
      for (const [x,y,r] of darkMud) g.fillCircle(x, y, r);
      // Светлые комочки земли
      g.fillStyle(0x6b4a28, 1);
      const lightMud: [number,number,number][] = [[7,8,2],[18,5,1.5],[29,12,2],[11,20,2.5],[22,22,2],[4,28,1.5],[26,28,2]];
      for (const [x,y,r] of lightMud) g.fillCircle(x, y, r);
      // Следы/вмятины — тёмные штрихи
      g.lineStyle(1, 0x2a1a08, 0.6);
      g.lineBetween(3, 12, 10, 14);
      g.lineBetween(18, 10, 24, 8);
      g.lineBetween(6, 22, 14, 24);
      g.lineBetween(20, 26, 28, 24);
      // Мелкий "мусор" — крошечные тёмные точки
      g.fillStyle(0x2a1a08, 1);
      const pebbles: [number,number][] = [[9,4],[21,9],[3,18],[28,16],[13,29],[24,3]];
      for (const [x,y] of pebbles) g.fillRect(x, y, 2, 2);
    });

    if (!this.textures.exists("tile-coral")) {
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
    }

    // ==========================================
    // ДИНАМИТ (TNT) — красный с фитилём
    if (!this.textures.exists("tile-tnt")) {
      // ==========================================
      const tntTile = this.add.graphics();
      tntTile.fillStyle(0xcc2222, 1);
      tntTile.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      // Коробка
      tntTile.fillStyle(0xcc3333, 1);
      tntTile.fillRect(2, 6, 28, 24);
      tntTile.lineStyle(1, 0x881111, 0.8);
      tntTile.strokeRect(2, 6, 28, 24);
      // Надпись TNT
      tntTile.fillStyle(0xffffff, 1);
      tntTile.fillRect(6, 10, 20, 4);
      tntTile.fillRect(6, 16, 20, 4);
      tntTile.fillRect(6, 22, 20, 4);
      // Фитиль
      tntTile.lineStyle(2, 0x8B4513, 1);
      tntTile.lineBetween(16, 6, 16, 0);
      tntTile.lineBetween(16, 0, 20, 0);
      // Искра
      tntTile.fillStyle(0xffaa00, 1);
      tntTile.fillCircle(20, 0, 2);
      tntTile.fillStyle(0xffff00, 0.8);
      tntTile.fillCircle(20, 0, 1);
      tntTile.generateTexture("tile-tnt", TILE_SIZE, TILE_SIZE);
      tntTile.destroy();
    }

    if (!this.textures.exists("tile-mythic-tree")) {
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
    }
  } // конец createTextures

  private createWaterShader() {
    if (this.renderer.type !== Phaser.WEBGL) return;

    // Phaser 3 передаёт UV-координаты фрагмента через outTexCoord (varying vec2).
    // fragCoord — это стандарт WebGL2/GLSL ES 3.0, но Phaser использует собственный
    // varying. resolution нужно передавать явно через uniforms при создании BaseShader.
    const fragShader = `
      precision mediump float;
      uniform float time;
      uniform vec2 resolution;
      // Phaser 3 пробрасывает UV в outTexCoord (не fragCoord!)
      varying vec2 outTexCoord;

      void main(void) {
        vec2 uv = outTexCoord;
        vec2 uv1 = uv;
        vec2 uv2 = uv;

        uv1.x += sin(time * 0.001 + uv.y * 10.0) * 0.02;
        uv1.y += cos(time * 0.001 + uv.x * 10.0) * 0.02;

        uv2.x -= cos(time * 0.0015 + uv.y * 15.0) * 0.015;
        uv2.y -= sin(time * 0.0015 + uv.x * 15.0) * 0.015;

        float intensity = (sin((uv1.x + uv2.y) * 20.0) + 1.0) * 0.5;
        vec3 color = mix(vec3(0.04, 0.24, 0.38), vec3(0.1, 0.42, 0.62), intensity);

        // Блики
        float highlight = pow(intensity, 4.0) * 0.5;
        color += vec3(0.2, 0.6, 0.8) * highlight;

        gl_FragColor = vec4(color, 0.85);
      }
    `;

    const canvasW = this.sys.game.canvas.width;
    const canvasH = this.sys.game.canvas.height;
    const worldW = MAP_W * TILE_SIZE;
    const worldH = MAP_H * TILE_SIZE;

    // Передаём resolution через uniforms-объект BaseShader
    const uniforms = {
      resolution: { type: '2f', value: { x: canvasW, y: canvasH } },
    };

    const shader = new Phaser.Display.BaseShader('WaterShader', fragShader, undefined, uniforms);

    // Шейдер растягивается на весь мир и лежит на depth 1 —
    // выше фона (depth -30) и ниже наземных тайлов (depth 5).
    // Водяные тайлы будут invisible + depth 0, и через них будет просвечивать этот шейдер.
    this.waterShader = this.add.shader(shader, worldW / 2, worldH / 2, worldW, worldH);
    this.waterShader.setDepth(1);
    this.waterShader.setScrollFactor(1);
  }

  private setupBloomAndLighting() {
    // Освещение отключено — убрано свечение вокруг игрока
  }

  // Получить "соседей" для автотайлинга
  private getTileNeighbors(x: number, y: number, type: TileId): number {
    let mask = 0;
    // Top
    if (y > 0 && this.tiles[y - 1][x] === type) mask |= 1;
    // Right
    if (x < MAP_W - 1 && this.tiles[y][x + 1] === type) mask |= 2;
    // Bottom
    if (y < MAP_H - 1 && this.tiles[y + 1][x] === type) mask |= 4;
    // Left
    if (x > 0 && this.tiles[y][x - 1] === type) mask |= 8;
    return mask;
  }

  private renderTiles(force = false) {
    if (force) {
      this.tileSprites.forEach(s => s?.destroy());
      this.tileSprites = [];
      this.groundSprites.forEach(s => s?.destroy());
      this.groundSprites = [];
    }

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const idx = y * MAP_W + x;
        const tile = this.tiles[y][x];
        const tex = this.tileTexture(tile);
        const px = x * TILE_SIZE + TILE_SIZE / 2;
        const py = y * TILE_SIZE + TILE_SIZE / 2;

        // 1. Создаем спрайт, если его нет
        if (!this.tileSprites[idx]) {
          this.tileSprites[idx] = this.add.image(px, py, tex).setOrigin(0.5);
        }
        
        const img = this.tileSprites[idx];
        img.setTexture(tex).clearTint();

        // 2. ЛОГИКА ВОДЫ
        if (tile === "water") {
          // Вода рендерится как обычный тайл, но на более низком depth
          img.setVisible(true);
          img.setAlpha(0.92);
          img.setDepth(2); // Ниже земли (depth 5), но выше фона
        } else {
          // Земля и объекты — отрисовываются поверх воды
          img.setVisible(true);
          img.setAlpha(this.tileAlpha(tile));
          img.setDepth(5);
        }

        // 3. Наземный слой (подложка под деревья/камни)
        if (this.obstacleTiles.has(tile)) {
           // Выбираем текстуру подложки по биому спрайта
           const savedBiome = img.getData('biome') as string | undefined;
           const groundTex = this.getGroundTextureForBiome(
             (savedBiome as BiomeType) ?? this.currentBiome
           ).texture;
           if (!this.groundSprites[idx]) {
             this.groundSprites[idx] = this.add.image(px, py, groundTex).setDepth(4).setOrigin(0.5);
           } else {
             this.groundSprites[idx]!.setTexture(groundTex);
           }
        } else if (this.groundSprites[idx]) {
           this.groundSprites[idx]?.destroy();
           this.groundSprites[idx] = null;
        }
      }
    }
  }

  private tileAlpha(tile: TileId) {
    return 0.92;
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
      case "coral": return "tile-coral";   // БАГ: отсутствовал — вызывал 'Texture not found'
      case "tnt": return "tile-tnt";
      case "dirt": return "tile-dirt";
      default: return "tile-grass";
    }
  }

  // Уничтожение спрайта тайла и замена его на траву (используется при взрыве TNT)
  private destroyTileSprite(tx: number, ty: number) {
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
      this.tileSprites[idx].setVisible(true);
      this.tileSprites[idx].setDepth(5);
    }

    const key = tile as Exclude<TileId, "empty" | "water">;
    this.inventory[key] = (this.inventory[key] ?? 0) + 1;
    this.emitInventory();

    this.cameras.main.shake(80, 0.003);
  }

  private placeTile(tx: number, ty: number) {
    const selectedItem = this.getSelectedItem();
    if (!selectedItem || selectedItem === "empty" || selectedItem === "water") return;

    // Маппинг специальных предметов → базовый TileId для физики/коллизий
    const specialToBase: Record<string, TileId> = {
      // Новые объекты → сами себя (чтобы правильно ставились и добывались)
      'crystal': 'crystal', 'mythic_rock': 'mythic_rock', 'mythic_grass': 'mythic_grass',
      'ice': 'ice', 'glass': 'glass', 'concrete': 'concrete', 'board': 'board',
      'plant': 'plant', 'glowing_mushroom': 'glowing_mushroom', 'ash': 'ash',
      'coral': 'coral', 'quartz': 'quartz', 'snowball': 'snowball',
      'mushroom': 'tree', 'bog': 'water', 'frozen_lake': 'frozen_lake',
      'tnt': 'tnt',
      'dirt': 'dirt',
    };

    const baseTile: TileId = specialToBase[selectedItem]
      ?? (() => {
        const first = selectedItem.split('_')[0] as TileId;
        const valid: TileId[] = ["grass","water","rock","tree","ruins","empty"];
        return valid.includes(first) ? first : "grass";
      })();

    if (baseTile === "empty") return;

    const baseKey = baseTile as Exclude<TileId, "empty" | "water">;

    // Проверяем наличие в инвентаре
    const biomeItem = this.inventoryWithBiomes[selectedItem];
    const simpleCount = this.inventory[baseKey] ?? 0;
    if ((!biomeItem || biomeItem.count <= 0) && simpleCount <= 0) return;

    // Получаем текстуру и tint
    const { tint: placeTint, texture: placeTexture } = this.getTintAndTextureForItem(selectedItem);

    // Обновляем тайл
    this.tiles[ty][tx] = baseTile;
    const idx = ty * MAP_W + tx;
    const sprite = this.tileSprites[idx];
    if (sprite) {
      sprite.setTexture(placeTexture);
      sprite.setAlpha(this.tileAlpha(baseTile));
      sprite.setVisible(true);
      sprite.setDepth(5);
      if (placeTint !== undefined) sprite.setTint(placeTint);
      else sprite.clearTint();
      sprite.setScale(1);
      const suffix = selectedItem.includes('_') ? selectedItem.split('_').slice(1).join('_') : '';
      const biomeType: BiomeType = suffix === 'snow' ? 'snow' : suffix === 'magma' ? 'lava' : suffix === 'sand' ? 'desert' : 'default';
      sprite.setData('biome', biomeType);
      sprite.setData('type', biomeType);
      sprite.setData('itemKey', selectedItem);
    }

    // Создаём/обновляем наземный подслой для объектов-препятствий
    // (иначе под объектом будет видна старая текстура или зелёный фон)
    const px = tx * TILE_SIZE + TILE_SIZE / 2;
    const py_coord = ty * TILE_SIZE + TILE_SIZE / 2;
    if (this.obstacleTiles.has(baseTile)) {
      // Определяем текстуру подложки по биому
      const suffix2 = selectedItem.includes('_') ? selectedItem.split('_').slice(1).join('_') : '';
      const biome2: BiomeType = suffix2 === 'snow' ? 'snow' : suffix2 === 'magma' ? 'lava' : suffix2 === 'sand' ? 'desert' : 'default';
      const { texture: groundTex } = this.getGroundTextureForBiome(biome2);
      if (!this.groundSprites[idx]) {
        this.groundSprites[idx] = this.add.image(px, py_coord, groundTex).setDepth(4).setOrigin(0.5);
      } else {
        this.groundSprites[idx]!.setTexture(groundTex).setVisible(true);
      }
    } else {
      // Не препятствие — убираем подслой если был
      if (this.groundSprites[idx]) {
        this.groundSprites[idx]?.destroy();
        this.groundSprites[idx] = null;
      }
    }

    // Списываем один раз
    const isPlaceable = (baseTile as string) !== 'water' && (baseTile as string) !== 'empty';
    if (biomeItem && biomeItem.count > 0) {
      biomeItem.count--;
      if (biomeItem.count <= 0) delete this.inventoryWithBiomes[selectedItem];
      if (isPlaceable)
        this.inventory[baseKey] = Math.max(0, (this.inventory[baseKey] ?? 0) - 1);
    } else {
      if (isPlaceable)
        this.inventory[baseKey] = Math.max(0, simpleCount - 1);
    }

    this.emitInventory();

    // Событие для React-подписчиков
    gameEvents.emit('tile-placed', {
      tile: baseTile,
      itemKey: selectedItem,
      x: tx,
      y: ty,
    });
  }

  // Возвращает текстуру и tint для любого биомного ключа предмета
  private getTintAndTextureForItem(itemKey: string): { tint: number | undefined, texture: string } {
    switch (itemKey) {
      // ── БАЗОВЫЕ ──────────────────────────────────────────────
      case 'grass':          return { tint: undefined, texture: 'tile-grass' };
      case 'rock':           return { tint: undefined, texture: 'tile-rock' };
      case 'tree':           return { tint: undefined, texture: 'tile-tree' };
      case 'ruins':          return { tint: undefined, texture: 'tile-ruins' };
      case 'water':          return { tint: undefined, texture: 'tile-water' };

      // ── СПЕЦИАЛЬНЫЕ ОБЪЕКТЫ (новые тайлы) ────────────────────
      case 'crystal':        return { tint: undefined, texture: 'tile-crystal' };
      case 'mythic_rock':    return { tint: undefined, texture: 'tile-mythic-rock' };
      case 'mythic_grass':   return { tint: undefined, texture: 'tile-mythic-grass' };
      case 'ice':            return { tint: undefined, texture: 'tile-ice' };
      case 'glass':          return { tint: undefined, texture: 'tile-glass' };
      case 'concrete':       return { tint: undefined, texture: 'tile-concrete' };
      case 'board':          return { tint: undefined, texture: 'tile-board' };
      case 'plant':          return { tint: undefined, texture: 'tile-plant' };
      case 'glowing_mushroom': return { tint: undefined, texture: 'tile-glow-mushroom' };
      case 'snowball':       return { tint: undefined, texture: 'tile-snowball' };
      case 'frozen_lake':    return { tint: undefined, texture: 'tile-frozen-lake' };
      case 'quartz':         return { tint: undefined, texture: 'tile-quartz' };
      case 'ash':            return { tint: undefined, texture: 'tile-ash' };
      case 'coral':          return { tint: undefined, texture: 'tile-coral' };
      case 'mushroom':       return { tint: undefined, texture: 'tile-mushroom' };
      case 'bog':            return { tint: undefined, texture: 'tile-bog' };
      case 'tnt':            return { tint: undefined, texture: 'tile-tnt' };
      case 'dirt':           return { tint: undefined, texture: 'tile-dirt' };

      // ── СНЕЖНЫЙ БИОМ  ─────────────────────────────────────────
      case 'grass_snow':     return { tint: undefined, texture: 'tile-snow' };
      case 'tree_snow':      return { tint: undefined, texture: 'tile-pine-snow' };
      case 'rock_snow':      return { tint: 0xcce5ff,  texture: 'tile-rock' };
      case 'ruins_snow':     return { tint: 0xcce5ff,  texture: 'tile-ruins' };
      case 'water_snow':     return { tint: 0x88ccff,  texture: 'tile-water' };

      // ── ЛАВОВЫЙ БИОМ ─────────────────────────────────────────
      case 'grass_magma':    return { tint: undefined, texture: 'tile-magma' };
      case 'tree_magma':     return { tint: 0x333333,  texture: 'tile-volcanic' };
      case 'rock_magma':     return { tint: 0x444444,  texture: 'tile-volcanic' };
      case 'ruins_magma':    return { tint: 0x444444,  texture: 'tile-ruins' };

      // ── ПУСТЫННЫЙ БИОМ ───────────────────────────────────────
      case 'grass_sand':     return { tint: undefined, texture: 'tile-sand' };
      case 'tree_sand':      return { tint: undefined, texture: 'tile-cactus' };
      case 'rock_sand':      return { tint: 0xccbb99,  texture: 'tile-rock' };
      case 'ruins_sand':     return { tint: 0xccbb99,  texture: 'tile-ruins' };

      default: {
        // Фолбэк: пробуем texture по имени напрямую (tile-{itemKey})
        // Это позволяет ставить любые новые тайлы добавленные в будущем
        const directTexture = `tile-${itemKey.replace(/_/g, '-')}`;
        const parts = itemKey.split('_');
        const base = parts[0] as TileId;
        const validBase: TileId[] = ['grass','water','rock','tree','ruins'];
        if (validBase.includes(base)) {
          return { tint: undefined, texture: this.tileTexture(base) };
        }
        return { tint: undefined, texture: directTexture };
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
      "grass", "tree", "rock", "ruins", "ice", "mythic_grass", "mythic_rock",
      "crystal", "snowball", "quartz", "board", "glass", "concrete",
      "plant", "glowing_mushroom", "ash", "coral", "tnt", "dirt"
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

    // ══════════════════════════════════════════════
    // СПЕЦИАЛЬНЫЕ ВЗАИМОДЕЙСТВИЯ
    // ══════════════════════════════════════════════

    // 🧨 ТНТ — взрыв: разрушает всё в радиусе 3 тайла
    if (tile === "tnt") {
      this.triggerTntExplosion(tx, ty);
      return;
    }

<<<<<<< HEAD
    // 🌿 ТРАВА / ПЕСОК / СНЕГ / МАГМА — копается, учитываем биом
    if (tile === "grass") {
      const idx_g = ty * MAP_W + tx;
      const sprite_g = this.tileSprites[idx_g];
      const tileBiome_g = (sprite_g?.getData('biome') as BiomeType) || this.currentBiome;
      const biomeItemId_g = this.getBiomeItemId("grass", tileBiome_g);

      // Визуальный эффект — цвет зависит от биома
      const debrisColor = tileBiome_g === 'desert' ? 0xd4aa70 : tileBiome_g === 'lava' ? 0xff4400 : tileBiome_g === 'snow' ? 0xccddff : 0x3a7a45;
      this.spawnDebrisEffect(px, py, debrisColor, 6);

      // После разрушения кладём грязь (или биомный фон)
      const { texture: bgTex, tint: bgTint } = this.getGroundTextureForBiome(tileBiome_g === 'default' ? 'default' : tileBiome_g);
      // Для биомов оставляем их фон, для default — грязь
      if (tileBiome_g === 'default') {
        this.setTileVisual(tx, ty, "dirt", "tile-dirt");
      } else {
        this.tiles[ty][tx] = "grass";
        if (sprite_g) {
          sprite_g.setTexture(bgTex);
          if (bgTint !== undefined) sprite_g.setTint(bgTint); else sprite_g.clearTint();
          sprite_g.setScale(1); sprite_g.setDepth(5);
          sprite_g.setData('biome', tileBiome_g); sprite_g.setData('type', tileBiome_g);
          sprite_g.setData('itemKey', null);
        }
      }
      this.cameras.main.shake(60, 0.002);

      // Выдаём правильный предмет (трава / песок / снеж.трава / магм.порода)
      if (!this.inventoryWithBiomes[biomeItemId_g]) {
        this.inventoryWithBiomes[biomeItemId_g] = { id: "grass", type: tileBiome_g, tint: undefined, scale: 1, count: 0 };
      }
      this.inventoryWithBiomes[biomeItemId_g].count += 1;
      const invKey_g = biomeItemId_g as TileId;
      this.inventory[invKey_g] = (this.inventory[invKey_g] ?? 0) + 1;
      this.emitInventory();
      const displayName_g = this.getItemDisplayName(biomeItemId_g);
      this.showFloatingText(px, py, `+1 ${displayName_g}`);
      gameEvents.emit('block-collected', { type: biomeItemId_g, amount: 1, baseId: "grass", biome: tileBiome_g });
      gameEvents.emit('tile-broken', { tile, itemKey: biomeItemId_g, x: tx, y: ty });
=======
    // 🌿 ТРАВА — копается, превращается в грязь
    if (tile === "grass") {
      this.spawnDebrisEffect(px, py, 0x3a7a45, 6);
      this.setTileVisual(tx, ty, "dirt", "tile-dirt");
      this.cameras.main.shake(60, 0.002);

      // Выдаём траву в инвентарь
      if (!this.inventoryWithBiomes["grass"]) {
        this.inventoryWithBiomes["grass"] = { id: "grass", type: "default", tint: undefined, scale: 1, count: 0 };
      }
      this.inventoryWithBiomes["grass"].count += 1;
      this.inventory["grass"] = (this.inventory["grass"] ?? 0) + 1;
      this.emitInventory();
      this.showFloatingText(px, py, `+1 🌿 Трава`);
      gameEvents.emit('block-collected', { type: "grass", amount: 1, baseId: "grass", biome: "default" });
      gameEvents.emit('tile-broken', { tile, itemKey: "grass", x: tx, y: ty });
>>>>>>> b68369ca310951aa4862415938f1c2680dc434bf
      return;
    }


    if (tile === "ice") {
      this.spawnCrackEffect(px, py, 0x88ccee);
      this.setTileVisual(tx, ty, "dirt", "tile-dirt");
      this.showFloatingText(px, py, `❄️ Лёд треснул!`);
      this.cameras.main.shake(80, 0.003);
      return; // лёд не даёт предмет — просто оставляет грязь
    }

<<<<<<< HEAD
    // 🌲 ДЕРЕВО — ломается на доски (default) или биомный эквивалент
    if (tile === "tree") {
      const idx_t = ty * MAP_W + tx;
      const sprite_t = this.tileSprites[idx_t];
      const tileBiome_t = (sprite_t?.getData('biome') as BiomeType) || this.currentBiome;

      this.cameras.main.shake(120, 0.005);

      if (tileBiome_t === 'default' || tileBiome_t === 'snow') {
        // Обычное дерево и снежная ель → доски
        this.spawnDebrisEffect(px, py, tileBiome_t === 'snow' ? 0x6b9fbf : 0x6b4226, 12);
        const { texture: bgTex2, tint: bgTint2 } = this.getGroundTextureForBiome(tileBiome_t);
        if (tileBiome_t === 'default') {
          this.setTileVisual(tx, ty, "dirt", "tile-dirt");
        } else {
          // Снег: под елью оставляем снежный фон
          this.tiles[ty][tx] = "grass";
          const s2 = this.tileSprites[ty * MAP_W + tx];
          if (s2) {
            s2.setTexture(bgTex2);
            if (bgTint2 !== undefined) s2.setTint(bgTint2); else s2.clearTint();
            s2.setScale(1); s2.setDepth(5);
            s2.setData('biome', tileBiome_t); s2.setData('type', tileBiome_t); s2.setData('itemKey', null);
          }
        }
        const boardCount = 2 + Math.floor(this.rng() * 2);
        if (!this.inventoryWithBiomes["board"]) {
          this.inventoryWithBiomes["board"] = { id: "board", type: "default", tint: undefined, scale: 1, count: 0 };
        }
        this.inventoryWithBiomes["board"].count += boardCount;
        this.inventory["board" as TileId] = (this.inventory["board" as TileId] ?? 0) + boardCount;
        this.emitInventory();
        this.showFloatingText(px, py, `+${boardCount} 🪵 Досок`);
        gameEvents.emit('block-collected', { type: "board", amount: boardCount, baseId: "board", biome: "default" });
        gameEvents.emit('block-collected', { type: "tree", amount: 1, baseId: "tree", biome: tileBiome_t });
        gameEvents.emit('tile-broken', { tile, itemKey: "board", x: tx, y: ty });
      } else {
        // Кактус (desert) и Уголь (lava) → свой предмет x1
        const biomeItemId_t = this.getBiomeItemId("tree", tileBiome_t);
        const debrisColor_t = tileBiome_t === 'desert' ? 0x4a7a3a : 0x333333;
        this.spawnDebrisEffect(px, py, debrisColor_t, 8);
        // Под биомным деревом оставляем биомный фон
        const { texture: bgTex_t, tint: bgTint_t } = this.getGroundTextureForBiome(tileBiome_t);
        this.tiles[ty][tx] = "grass";
        if (sprite_t) {
          sprite_t.setTexture(bgTex_t);
          if (bgTint_t !== undefined) sprite_t.setTint(bgTint_t); else sprite_t.clearTint();
          sprite_t.setScale(1); sprite_t.setDepth(5);
          sprite_t.setData('biome', tileBiome_t); sprite_t.setData('type', tileBiome_t);
          sprite_t.setData('itemKey', null);
        }
        if (!this.inventoryWithBiomes[biomeItemId_t]) {
          this.inventoryWithBiomes[biomeItemId_t] = { id: "tree", type: tileBiome_t, tint: undefined, scale: 1, count: 0 };
        }
        this.inventoryWithBiomes[biomeItemId_t].count += 1;
        const invKeyT = biomeItemId_t as TileId;
        this.inventory[invKeyT] = (this.inventory[invKeyT] ?? 0) + 1;
        this.emitInventory();
        const displayName_t = this.getItemDisplayName(biomeItemId_t);
        this.showFloatingText(px, py, `+1 ${displayName_t}`);
        gameEvents.emit('block-collected', { type: biomeItemId_t, amount: 1, baseId: "tree", biome: tileBiome_t });
        gameEvents.emit('block-collected', { type: "tree", amount: 1, baseId: "tree", biome: tileBiome_t });
        gameEvents.emit('tile-broken', { tile, itemKey: biomeItemId_t, x: tx, y: ty });
      }
=======
    // 🌲 ДЕРЕВО — ломается на доски
    if (tile === "tree") {
      this.spawnDebrisEffect(px, py, 0x6b4226, 12);
      // Кладём грязь под деревом вместо травы
      this.setTileVisual(tx, ty, "dirt", "tile-dirt");
      this.cameras.main.shake(120, 0.005);

      // Выдаём доски (2-3 штуки)
      const boardCount = 2 + Math.floor(this.rng() * 2);
      const baseKey: TileId = "board";
      if (!this.inventoryWithBiomes["board"]) {
        this.inventoryWithBiomes["board"] = { id: "board", type: "default", tint: undefined, scale: 1, count: 0 };
      }
      this.inventoryWithBiomes["board"].count += boardCount;
      this.inventory[baseKey] = (this.inventory[baseKey] ?? 0) + boardCount;
      this.emitInventory();
      this.showFloatingText(px, py, `+${boardCount} 🪵 Досок`);
      gameEvents.emit('block-collected', { type: "board", amount: boardCount, baseId: "board", biome: "default" });
      gameEvents.emit('tile-broken', { tile, itemKey: "board", x: tx, y: ty });
>>>>>>> b68369ca310951aa4862415938f1c2680dc434bf
      return;
    }

    // ══════════════════════════════════════════════
    // СТАНДАРТНОЕ РАЗРУШЕНИЕ (все остальные тайлы)
    // ══════════════════════════════════════════════
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
      sprite.setDepth(5);
      sprite.setData('type', tileBiome === 'default' ? 'default' : tileBiome);
      sprite.setData('biome', tileBiome === 'default' ? 'default' : tileBiome);
      sprite.setData('itemKey', null);
    }

    // Убираем groundSprite подложку (она нужна только под obstacle-объектами)
    if (this.groundSprites[idx]) {
      this.groundSprites[idx]?.destroy();
      this.groundSprites[idx] = null;
    }

    // Добавляем предмет в inventoryWithBiomes (единый источник правды)
<<<<<<< HEAD
    // baseKey — базовый тип тайла (grass, rock, tree...), biomeItemId — полный ключ (grass_sand, rock_snow...)
    const baseKey = tile as Exclude<TileId, "empty" | "water">;
    // Используем biomeItemId как ключ инвентаря чтобы песок был "grass_sand", а не "grass"
    const inventoryKey = biomeItemId;
    if (!this.inventoryWithBiomes[inventoryKey]) {
      const biomeType = this.getBiomeTypeFromItemId(inventoryKey);
      this.inventoryWithBiomes[inventoryKey] = { 
=======
    const baseKey = tile as Exclude<TileId, "empty" | "water">;
    if (!this.inventoryWithBiomes[biomeItemId]) {
      const biomeType = this.getBiomeTypeFromItemId(biomeItemId);
      this.inventoryWithBiomes[biomeItemId] = { 
>>>>>>> b68369ca310951aa4862415938f1c2680dc434bf
        id: baseKey, 
        type: biomeType,
        tint: undefined, 
        scale: 1,
        count: 0 
      };
    }
<<<<<<< HEAD
    this.inventoryWithBiomes[inventoryKey].count++;
    
    // Синхронизируем обычный инвентарь по biomeItemId ключу
    const invKey = inventoryKey as TileId;
    this.inventory[invKey] = (this.inventory[invKey] ?? 0) + 1;
    this.emitInventory();

    // Генерируем событие для React
    const biomeType = this.getBiomeTypeFromItemId(inventoryKey);
    gameEvents.emit('block-collected', { 
      type: inventoryKey, 
=======
    this.inventoryWithBiomes[biomeItemId].count++;
    
    // Синхронизируем обычный инвентарь (по базовому ключу — для обратной совместимости)
    this.inventory[baseKey] = (this.inventory[baseKey] ?? 0) + 1;
    this.emitInventory();

    // Генерируем событие для React
    const biomeType = this.getBiomeTypeFromItemId(biomeItemId);
    gameEvents.emit('block-collected', { 
      type: biomeItemId, 
>>>>>>> b68369ca310951aa4862415938f1c2680dc434bf
      amount: 1,
      baseId: baseKey,
      biome: biomeType
    });

    console.log("Добыт предмет:", biomeItemId);

    // Событие: тайл сломан
    gameEvents.emit('tile-broken', {
      tile: tile,
      itemKey: biomeItemId,
      x: tx,
      y: ty,
    });

    // Показываем всплывающий текст
    const displayName = this.getItemDisplayName(biomeItemId);
    this.showFloatingText(px, py, `+1 ${displayName}`);
  }

  // ══════════════════════════════════════════════
  // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ВЗАИМОДЕЙСТВИЙ
  // ══════════════════════════════════════════════

  /** Заменяет тайл визуально и в массиве tiles */
  private setTileVisual(tx: number, ty: number, newTile: TileId, textureKey: string, tint?: number) {
    this.tiles[ty][tx] = newTile;
    const idx = ty * MAP_W + tx;
    const sprite = this.tileSprites[idx];
    if (sprite) {
      sprite.setTexture(textureKey);
      sprite.setAlpha(this.tileAlpha(newTile));
      if (tint !== undefined) sprite.setTint(tint);
      else sprite.clearTint();
      sprite.setScale(1);
      sprite.setDepth(5);
      sprite.setData('biome', 'default');
      sprite.setData('type', 'default');
      sprite.setData('itemKey', null);
    }
    if (this.groundSprites[idx]) {
      this.groundSprites[idx]?.destroy();
      this.groundSprites[idx] = null;
    }
  }

  /** Эффект трещин (лёд) */
  private spawnCrackEffect(px: number, py: number, color: number) {
    // Серия коротких линий-трещин
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const len = 10 + Math.random() * 12;
      const line = this.add.graphics();
      line.lineStyle(2, color, 1);
      line.lineBetween(0, 0, Math.cos(angle) * len, Math.sin(angle) * len);
      line.setPosition(px, py);
      line.setDepth(25);
      this.tweens.add({
        targets: line,
        alpha: 0,
        scaleX: 1.8,
        scaleY: 1.8,
        duration: 400,
        onComplete: () => line.destroy(),
      });
    }
    this.cameras.main.shake(60, 0.004);
  }

  /** Эффект разлёта обломков (дерево) */
  private spawnDebrisEffect(px: number, py: number, color: number, count: number) {
    this.destructionParticles.emitParticleAt(px, py, count);
    const flash = this.add.circle(px, py, TILE_SIZE * 0.8, color, 0.35);
    flash.setDepth(25);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.6,
      duration: 350,
      onComplete: () => flash.destroy(),
    });
  }

  /** Взрыв TNT — разрушает тайлы в радиусе и заменяет траву грязью */
  private triggerTntExplosion(cx: number, cy: number) {
    const radius = 3;
    const epx = cx * TILE_SIZE + TILE_SIZE / 2;
    const epy = cy * TILE_SIZE + TILE_SIZE / 2;

    // Большой взрыв — вспышка
    const blast = this.add.circle(epx, epy, radius * TILE_SIZE, 0xff4400, 0.7);
    blast.setDepth(30);
    this.tweens.add({
      targets: blast,
      alpha: 0,
      scale: 1.8,
      duration: 500,
      onComplete: () => blast.destroy(),
    });
    const innerBlast = this.add.circle(epx, epy, radius * TILE_SIZE * 0.5, 0xffcc00, 0.9);
    innerBlast.setDepth(31);
    this.tweens.add({
      targets: innerBlast,
      alpha: 0,
      scale: 2.2,
      duration: 350,
      onComplete: () => innerBlast.destroy(),
    });

    this.destructionParticles.emitParticleAt(epx, epy, 40);
    this.cameras.main.shake(400, 0.018);

    // Убираем сам TNT тайл
    this.setTileVisual(cx, cy, "dirt", "tile-dirt");

    // Разрушаем тайлы в радиусе
    const destroyable: TileId[] = [
      "tree","rock","ruins","ice","mythic_rock","quartz","glass","concrete",
      "coral","crystal","plant","glowing_mushroom","tnt","board","snowball",
    ];

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dy === 0) continue;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;

        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;

        const t = this.tiles[ny][nx];

        if (t === "tnt") {
          // Цепная реакция с небольшой задержкой
          const delay = dist * 80 + 100;
          this.time.delayedCall(delay, () => {
            if (this.tiles[ny][nx] === "tnt") this.triggerTntExplosion(nx, ny);
          });
        } else if (destroyable.includes(t)) {
          // Уничтожаем объект без добавления в инвентарь
          this.setTileVisual(nx, ny, "dirt", "tile-dirt");
          this.destructionParticles.emitParticleAt(nx * TILE_SIZE + TILE_SIZE / 2, ny * TILE_SIZE + TILE_SIZE / 2, 6);
        } else if (t === "grass") {
          // Трава → грязь от взрыва
          this.setTileVisual(nx, ny, "dirt", "tile-dirt");
        }
      }
    }

    this.showFloatingText(epx, epy - 20, `💥 БУМ!`);
    gameEvents.emit('tile-broken', { tile: "tnt", itemKey: "tnt", x: cx, y: cy });
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
      'dirt':            '🟫 Грязь',
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
    // Фолбэк: предметы в this.inventory которых нет в inventoryWithBiomes
    // (добавлены через ai-give-items или другие прямые пути)
    for (const [key, count] of Object.entries(this.inventory)) {
      if (count && count > 0 && !flatInventory[key]) {
        flatInventory[key] = count;
      }
    }
    this.onInventory(flatInventory);
    // Также отправляем расширенный инвентарь с биомами, если колбэк задан
    if (this.callbacks?.onInventoryWithBiomes) {
      this.callbacks.onInventoryWithBiomes({ ...this.inventoryWithBiomes });
    }
    // Событие для любых подписчиков
    gameEvents.emit('inventory-updated', flatInventory);
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
    gameEvents.emit('biome-changed', { biome: biomeType });
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
<<<<<<< HEAD
      // Оставляем tile = "grass" для ходьбы, но визуально — магма/вулкан
      // biome = lava → при добыче выдаст "grass_magma" (магматическая порода)
      if (r > 0.35) {
=======
      if (r > 0.35) {
        this.tiles[y][x] = "rock";
>>>>>>> b68369ca310951aa4862415938f1c2680dc434bf
        sprite.setTexture("tile-volcanic");
      } else {
        sprite.setTexture("tile-magma");
      }
      sprite.setData('biome', 'lava'); sprite.setData('type', 'lava');
    } else if (tile === "tree") {
<<<<<<< HEAD
      // Дерево → уголь или магма-пол (walkable)
      if (r > 0.5) {
=======
      // Дерево → уголь (тёмный вулканический) или магма
      if (r > 0.5) {
        this.tiles[y][x] = "rock";
>>>>>>> b68369ca310951aa4862415938f1c2680dc434bf
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
<<<<<<< HEAD
      // grass остаётся "grass" в tiles (проходимо), визуально — песок
      // biome=desert → при добыче даёт "grass_sand" = Песок
      sprite.setTexture("tile-sand");
      sprite.setData('biome', 'desert'); sprite.setData('type', 'desert');
      // Редкие кактусы поверх песка
      if (r > 0.88) {
        this.tiles[y][x] = "tree";
        sprite.setTexture("tile-cactus");
        // tree_desert → при ломании даст кактус
      }
=======
      sprite.setTexture("tile-sand");
      sprite.setData('biome', 'desert'); sprite.setData('type', 'desert');
>>>>>>> b68369ca310951aa4862415938f1c2680dc434bf
    } else if (tile === "tree") {
      // Дерево → кактус (60%) или песок (40%)
      if (r > 0.4) {
        sprite.setTexture("tile-cactus");
<<<<<<< HEAD
        // tile остаётся "tree" → при добыче: tree + biome=desert → "tree_sand" = Кактус
=======
>>>>>>> b68369ca310951aa4862415938f1c2680dc434bf
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
<<<<<<< HEAD
=======
    // Рассыпаем доп. кактусы
    if (tile === "grass" && r > 0.88) {
      this.tiles[y][x] = "tree";
      sprite.setTexture("tile-cactus");
    }
>>>>>>> b68369ca310951aa4862415938f1c2680dc434bf
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
      // В снежном биоме вода превращается в замёрзшее озеро
      this.tiles[y][x] = "frozen_lake";
      sprite.setTexture("tile-frozen-lake");
      sprite.setAlpha(this.tileAlpha("frozen_lake"));
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
      "E": { tile: "grass",  texture: "tile-grass",     biome: "default" },
      // === СНЕЖНЫЙ БИОМ ===
      "S": { tile: "grass",  texture: "tile-snow",      biome: "snow" },
      "I": { tile: "rock",   texture: "tile-rock",      tint: 0xcce5ff, biome: "snow" },
      "P": { tile: "tree",   texture: "tile-pine-snow", biome: "snow" },
      "L": { tile: "water",  texture: "tile-water",     tint: 0x88ccff, biome: "snow" },
      // === ЛАВОВЫЙ БИОМ ===
      "M": { tile: "grass",  texture: "tile-magma",     biome: "lava" },
      "V": { tile: "rock",   texture: "tile-volcanic",  biome: "lava" },
      "C": { tile: "tree",   texture: "tile-volcanic",  tint: 0x333333, biome: "lava" },
      "F": { tile: "water",  texture: "tile-water",     tint: 0xff4400, biome: "lava" },
      // === ПУСТЫННЫЙ БИОМ ===
      "D": { tile: "grass",  texture: "tile-sand",      biome: "desert" },
      "N": { tile: "rock",   texture: "tile-rock",      tint: 0xccbb99, biome: "desert" },
      "K": { tile: "tree",   texture: "tile-cactus",    biome: "desert" },
      // === БОЛОТО / ГОРОД ===
      "B": { tile: "grass",  texture: "tile-bog",       biome: "default" },
      "H": { tile: "tree",   texture: "tile-tree",      tint: 0x7a5a9a, biome: "default" },
      // extras из route.ts (нужно явно покрыть каждый):
      "X": { tile: "ruins",  texture: "tile-ruins",     tint: 0x8b7355, biome: "default" }, // куст/обломки
      "J": { tile: "ruins",  texture: "tile-mushroom",  biome: "default" },                 // гриб
      "Z": { tile: "rock",   texture: "tile-rock",      tint: 0x884400, biome: "lava" },    // обугл. камень
      "O": { tile: "water",  texture: "tile-water",     tint: 0x336644, biome: "desert" },  // оазис
      "Q": { tile: "ruins",  texture: "tile-ruins",     tint: 0xccbb99, biome: "desert" },  // руины пустыни
      "Y": { tile: "mythic_grass", texture: "tile-mythic-grass", biome: "default" },        // мифич. трава
      "A": { tile: "mythic_grass", texture: "tile-mythic-grass", tint: 0xff66ff, biome: "default" },
      // === МАЛЫЕ ОБЪЕКТЫ (route.ts extras) ===
      "i": { tile: "ice",           texture: "tile-ice",          biome: "snow"    },
      "z": { tile: "snowball",      texture: "tile-snowball",     biome: "snow"    },
      "l": { tile: "frozen_lake",   texture: "tile-frozen-lake",  biome: "snow"    },
      "y": { tile: "mythic_rock",   texture: "tile-mythic-rock",  biome: "default" },
      "c": { tile: "crystal",       texture: "tile-crystal",      biome: "default" },
      "q": { tile: "quartz",        texture: "tile-quartz",       biome: "default" },
      "b": { tile: "board",         texture: "tile-board",        biome: "default" },
      "a": { tile: "glass",         texture: "tile-glass",        biome: "default" },
      "e": { tile: "concrete",      texture: "tile-concrete",     biome: "default" },
      "p": { tile: "plant",         texture: "tile-plant",        biome: "default" },
      "g": { tile: "glowing_mushroom", texture: "tile-glow-mushroom", biome: "default" },
      "r": { tile: "ash",           texture: "tile-ash",          biome: "default" },
      "o": { tile: "coral",         texture: "tile-coral",        biome: "default" },
      // === ЦИФРОВЫЕ ПСЕВДОНИМЫ (route.ts extras: "0","4","5","6","7","8","9") ===
      "0": { tile: "rock",   texture: "tile-rock",      tint: 0x222222, biome: "default" }, // тёмный камень
      "4": { tile: "ruins",  texture: "tile-ruins",     biome: "default" },                 // руины
      "5": { tile: "grass",  texture: "tile-snow",      biome: "snow" },                    // снег
      "6": { tile: "grass",  texture: "tile-magma",     biome: "lava" },                    // магма
      "7": { tile: "tree",   texture: "tile-tree",      tint: 0x8b0000, biome: "default" }, // красное дерево
      "8": { tile: "tree",   texture: "tile-mythic-tree", biome: "default" },               // мифич. дерево
      "9": { tile: "tree",   texture: "tile-cactus",    biome: "desert" },                  // кактус
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
    gameEvents.emit('map-generated', { biome: this.currentBiome, rows: mapRows.length });
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
      "i": { tile: "ice",         texture: "tile-ice",         biome: "snow" },
      "c": { tile: "crystal",     texture: "tile-crystal",     biome: "default" },
      "y": { tile: "mythic_rock", texture: "tile-mythic-rock", biome: "default" },
      "q": { tile: "quartz",      texture: "tile-quartz",      biome: "default" },
      "b": { tile: "board",       texture: "tile-board",       biome: "default" },
      "a": { tile: "glass",       texture: "tile-glass",       biome: "default" },
      "e": { tile: "concrete",    texture: "tile-concrete",    biome: "default" },
      "p": { tile: "plant",       texture: "tile-plant",       biome: "default" },
      "g": { tile: "glowing_mushroom", texture: "tile-glow-mushroom", biome: "default" },
      "r": { tile: "ash",         texture: "tile-ash",         biome: "default" },
      "o": { tile: "coral",       texture: "tile-coral",       biome: "default" },
      "z": { tile: "snowball",    texture: "tile-snowball",    biome: "snow" },
      "d": { tile: "dirt",        texture: "tile-dirt",        biome: "default" },
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

  // Глобальная замена тайлов одного типа на другой по всей карте (patch_tiles)
  private applyPatchTiles(fromChar: string, toChar: string) {
    // Полная таблица символов → тайл+текстура (такая же как в applyAiChanges)
    const charMap: Record<string, { tile: TileId; texture: string; tint?: number; biome: BiomeType }> = {
      "G": { tile: "grass", texture: "tile-grass",      biome: "default" },
      "W": { tile: "water", texture: "tile-water",      biome: "default" },
      "R": { tile: "rock",  texture: "tile-rock",       biome: "default" },
      "T": { tile: "tree",  texture: "tile-tree",       biome: "default" },
      "U": { tile: "ruins", texture: "tile-ruins",      biome: "default" },
      "S": { tile: "grass", texture: "tile-snow",       biome: "snow" },
      "I": { tile: "rock",  texture: "tile-rock",       tint: 0xcce5ff, biome: "snow" },
      "P": { tile: "tree",  texture: "tile-pine-snow",  biome: "snow" },
      "L": { tile: "water", texture: "tile-water",      tint: 0x88ccff, biome: "snow" },
      "M": { tile: "grass", texture: "tile-magma",      biome: "lava" },
      "V": { tile: "rock",  texture: "tile-volcanic",   biome: "lava" },
      "C": { tile: "tree",  texture: "tile-volcanic",   tint: 0x333333, biome: "lava" },
      "F": { tile: "water", texture: "tile-water",      tint: 0xff4400, biome: "lava" },
      "D": { tile: "grass", texture: "tile-sand",       biome: "desert" },
      "N": { tile: "rock",  texture: "tile-rock",       tint: 0xccbb99, biome: "desert" },
      "K": { tile: "tree",  texture: "tile-cactus",     biome: "desert" },
      "B": { tile: "grass", texture: "tile-grass",      tint: 0x888888, biome: "default" },
      "H": { tile: "rock",  texture: "tile-rock",       tint: 0x8b7355, biome: "default" },
      "Z": { tile: "ruins", texture: "tile-ruins",      tint: 0xddaa44, biome: "default" },
      "c": { tile: "crystal",     texture: "tile-crystal",    biome: "default" },
      "y": { tile: "mythic_rock", texture: "tile-mythic-rock", biome: "default" },
      "i": { tile: "ice",         texture: "tile-ice",         biome: "snow" },
      "q": { tile: "quartz",      texture: "tile-quartz",      biome: "default" },
      "b": { tile: "board",       texture: "tile-board",       biome: "default" },
      "a": { tile: "glass",       texture: "tile-glass",       biome: "default" },
      "e": { tile: "concrete",    texture: "tile-concrete",    biome: "default" },
      "p": { tile: "plant",       texture: "tile-plant",       biome: "default" },
      "g": { tile: "glowing_mushroom", texture: "tile-glow-mushroom", biome: "default" },
      "r": { tile: "ash",         texture: "tile-ash",         biome: "default" },
      "o": { tile: "coral",       texture: "tile-coral",       biome: "default" },
      "z": { tile: "snowball",    texture: "tile-snowball",    biome: "snow" },
      "d": { tile: "dirt",        texture: "tile-dirt",        biome: "default" },
    };

    const fromDef = charMap[fromChar];
    const toDef   = charMap[toChar];
    if (!fromDef || !toDef) {
      console.warn(`[applyPatchTiles] Неизвестный символ: from=${fromChar} to=${toChar}`);
      return;
    }

    let count = 0;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const idx = y * MAP_W + x;
        const sprite = this.tileSprites[idx];
        if (!sprite) continue;
        // Совпадение только по TileId (убрана жёсткая проверка текстуры — она ломала замену биомных тайлов)
        if (this.tiles[y][x] !== fromDef.tile) continue;

        this.tiles[y][x] = toDef.tile;
        sprite.setTexture(toDef.texture);
        sprite.setAlpha(this.tileAlpha(toDef.tile));
        sprite.setScale(1);
        if (toDef.tint !== undefined) sprite.setTint(toDef.tint);
        else sprite.clearTint();
        sprite.setData("biome", toDef.biome);
        count++;
      }
    }

    this.repositionPlayerOnWalkable();
    this.cameras.main.shake(200, 0.004);
    this.showFloatingText(this.player.x, this.player.y - 50, `🎨 Заменено: ${count} тайлов`);
    console.log(`[applyPatchTiles] ${fromChar}→${toChar}: заменено ${count} тайлов`);
    gameEvents.emit('tiles-patched', { from: fromChar, to: toChar, count });
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
      "d": { tile: "dirt",  texture: "tile-dirt",      biome: "default" }, // грязь
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
      кристалл: "c", "снежный комок": "z", снежком: "z", "снежный ком": "z", snowball: "z",
      "замёрзшее озеро": "l", "замерзшее озеро": "l",
      кварц: "q", доска: "b", стекло: "a", бетон: "e",
      растение: "p", "светящийся гриб": "g", коралл: "o",
      "мифическое дерево": "A", "мифдерево": "A",
    };

    const px = Math.floor(this.player.x / TILE_SIZE);
    const py = Math.floor(this.player.y / TILE_SIZE);

    let addedToInventory = 0;
    for (const obj of objects) {
      const tx = px + obj.dx;
      const ty = py + obj.dy;
      if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) continue;
      // Поддержка русских названий объектов
      const rawTile = obj.tile ?? "R";
      const tileKey = nameToTile[rawTile.toLowerCase()] ?? rawTile;
      // Прямой фолбэк: если tileKey это TileId (snowball, ice, tnt...) — строим def напрямую
      const directDef: Record<string, { tile: TileId; texture: string; tint?: number; biome: BiomeType }> = {
        snowball:        { tile: "snowball",        texture: "tile-snowball",      biome: "snow"    },
        ice:             { tile: "ice",             texture: "tile-ice",           biome: "snow"    },
        tnt:             { tile: "tnt",             texture: "tile-tnt",           biome: "default" },
        crystal:         { tile: "crystal",         texture: "tile-crystal",       biome: "default" },
        quartz:          { tile: "quartz",          texture: "tile-quartz",        biome: "default" },
        board:           { tile: "board",           texture: "tile-board",         biome: "default" },
        glass:           { tile: "glass",           texture: "tile-glass",         biome: "default" },
        concrete:        { tile: "concrete",        texture: "tile-concrete",      biome: "default" },
        plant:           { tile: "plant",           texture: "tile-plant",         biome: "default" },
        glowing_mushroom:{ tile: "glowing_mushroom",texture: "tile-glow-mushroom", biome: "default" },
        ash:             { tile: "ash",             texture: "tile-ash",           biome: "default" },
        coral:           { tile: "coral",           texture: "tile-coral",         biome: "default" },
        frozen_lake:     { tile: "frozen_lake",     texture: "tile-frozen-lake",   biome: "snow"    },
        mythic_rock:     { tile: "mythic_rock",     texture: "tile-mythic-rock",   biome: "default" },
        mythic_grass:    { tile: "mythic_grass",    texture: "tile-mythic-grass",  biome: "default" },
      };
      const def = charMap[tileKey] ?? directDef[tileKey] ?? directDef[rawTile.toLowerCase()] ?? charMap["R"]!;
      const idx = ty * MAP_W + tx;
      const sprite = this.tileSprites[idx];
      if (!sprite) continue;
      this.tiles[ty][tx] = def.tile;
      sprite.setTexture(def.texture);
      sprite.setAlpha(this.tileAlpha(def.tile));
      sprite.setScale(1);
      sprite.setDepth(5);
      if (def.tint !== undefined) sprite.setTint(def.tint);
      else sprite.clearTint();
      sprite.setData("biome", def.biome);
      sprite.setData("itemKey", def.tile);
      // Создаём подложку для obstacle-тайлов (иначе чёрный/зелёный квадрат)
      const spx = tx * TILE_SIZE + TILE_SIZE / 2;
      const spy = ty * TILE_SIZE + TILE_SIZE / 2;
      if (this.obstacleTiles.has(def.tile)) {
        const { texture: groundTex } = this.getGroundTextureForBiome(def.biome);
        if (!this.groundSprites[idx]) {
          this.groundSprites[idx] = this.add.image(spx, spy, groundTex).setDepth(4).setOrigin(0.5);
        } else {
          this.groundSprites[idx]!.setTexture(groundTex).setVisible(true);
        }
      } else {
        if (this.groundSprites[idx]) {
          this.groundSprites[idx]?.destroy();
          this.groundSprites[idx] = null;
        }
      }
      // Добавляем предмет в инвентарь игрока
      if (def.tile !== "grass" && def.tile !== "water" && def.tile !== "empty") {
        const invKey = def.tile as Exclude<TileId, "empty" | "water">;
        // Синхронизируем ОБА словаря, иначе emitInventory() не увидит предмет
        this.inventory[invKey] = (this.inventory[invKey] ?? 0) + 1;
        const biomeItemId = def.tile; // для AI-объектов используем базовый ключ
        if (!this.inventoryWithBiomes[biomeItemId]) {
          this.inventoryWithBiomes[biomeItemId] = {
            id: invKey,
            type: def.biome === "snow" ? "snow" : def.biome === "lava" ? "lava" : def.biome === "desert" ? "desert" : "default",
            tint: def.tint,
            scale: 1,
            count: 0,
          };
        }
        this.inventoryWithBiomes[biomeItemId].count++;
        addedToInventory++;
        // Генерируем событие для подписчиков (React, квесты и т.д.)
        gameEvents.emit('block-collected', {
          type: biomeItemId,
          amount: 1,
          baseId: invKey,
          biome: def.biome,
        });
      }
    }
    if (addedToInventory > 0) {
      this.emitInventory();
    }

    this.cameras.main.shake(100, 0.002);
    this.showFloatingText(this.player.x, this.player.y - 50, "📦 Объекты размещены!");
    gameEvents.emit('objects-placed', { count: objects.length });
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
        gameEvents.emit('time-changed', { time });
      },
    });
  }

  // Строительство структуры (замок, башня, дом и т.д.)
  public buildStructure(type: string, startX: number, startY: number, width: number, height: number, material?: string) {
    const mat = (material ?? type).toLowerCase();

    type TileDef = { tile: TileId; texture: string; tint?: number };

    // ── Материальная палитра ───────────────────────────────────────
    const MATS: Record<string, { wall: TileDef; floor: TileDef; accent: TileDef; roof: TileDef }> = {
      rock:          { wall:   { tile:"rock",         texture:"tile-rock"          },
                       floor:  { tile:"grass",        texture:"tile-grass"         },
                       accent: { tile:"ruins",        texture:"tile-ruins"         },
                       roof:   { tile:"rock",         texture:"tile-rock",         tint:0x888888 } },
      glass:         { wall:   { tile:"glass",        texture:"tile-glass"         },
                       floor:  { tile:"glass",        texture:"tile-glass",        tint:0xccffff },
                       accent: { tile:"crystal",      texture:"tile-crystal"       },
                       roof:   { tile:"glass",        texture:"tile-glass",        tint:0x88ddff } },
      ice:           { wall:   { tile:"ice",          texture:"tile-ice"           },
                       floor:  { tile:"grass",        texture:"tile-snow"          },
                       accent: { tile:"rock",         texture:"tile-rock",         tint:0xaaddff },
                       roof:   { tile:"ice",          texture:"tile-ice",          tint:0xbbeeff } },
      concrete:      { wall:   { tile:"concrete",     texture:"tile-concrete"      },
                       floor:  { tile:"concrete",     texture:"tile-concrete",     tint:0xbbbbbb },
                       accent: { tile:"rock",         texture:"tile-rock",         tint:0x555555 },
                       roof:   { tile:"concrete",     texture:"tile-concrete",     tint:0x999999 } },
      board:         { wall:   { tile:"board",        texture:"tile-board"         },
                       floor:  { tile:"board",        texture:"tile-board",        tint:0xcc9944 },
                       accent: { tile:"ruins",        texture:"tile-ruins",        tint:0x886633 },
                       roof:   { tile:"board",        texture:"tile-board",        tint:0xaa7722 } },
      mythic_rock:   { wall:   { tile:"mythic_rock",  texture:"tile-mythic-rock"   },
                       floor:  { tile:"grass",        texture:"tile-grass",        tint:0xcc88ff },
                       accent: { tile:"crystal",      texture:"tile-crystal"       },
                       roof:   { tile:"mythic_rock",  texture:"tile-mythic-rock",  tint:0x9955cc } },
      crystal:       { wall:   { tile:"crystal",      texture:"tile-crystal"       },
                       floor:  { tile:"grass",        texture:"tile-grass",        tint:0xaaffee },
                       accent: { tile:"quartz",       texture:"tile-quartz"        },
                       roof:   { tile:"crystal",      texture:"tile-crystal",      tint:0x88ffdd } },
      volcanic_rock: { wall:   { tile:"rock",         texture:"tile-volcanic"      },
                       floor:  { tile:"grass",        texture:"tile-magma",        tint:0x441100 },
                       accent: { tile:"ruins",        texture:"tile-ruins",        tint:0xff4400 },
                       roof:   { tile:"rock",         texture:"tile-volcanic",     tint:0x882200 } },
    };

    const palette = MATS[mat] ?? MATS.rock;
    const { wall, floor, accent, roof } = palette;

    // Хелпер: установить тайл
    const setTile = (x: number, y: number, def: TileDef) => {
      if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return;
      const idx = y * MAP_W + x;
      const sprite = this.tileSprites[idx];
      if (!sprite) return;
      this.tiles[y][x] = def.tile;
      sprite.setTexture(def.texture);
      sprite.setAlpha(this.tileAlpha(def.tile));
      sprite.setScale(1);
      if (def.tint !== undefined) sprite.setTint(def.tint);
      else sprite.clearTint();
      sprite.setData("biome", "default");
    };

    const btype = type.toLowerCase();

    // ══════════════════════════════════════════════════════════════
    // ЗАМОК / ФОРТ
    // ══════════════════════════════════════════════════════════════
    if (btype === "castle" || btype === "fort") {
      // Заливаем пол
      for (let dy = 1; dy < height - 1; dy++)
        for (let dx = 1; dx < width - 1; dx++)
          setTile(startX + dx, startY + dy, floor);

      // Внешние стены
      for (let dx = 0; dx < width; dx++) {
        setTile(startX + dx, startY,           wall);
        setTile(startX + dx, startY + height - 1, wall);
      }
      for (let dy = 1; dy < height - 1; dy++) {
        setTile(startX,           startY + dy, wall);
        setTile(startX + width-1, startY + dy, wall);
      }

      // Угловые башни (3×3 с акцентом в углу)
      const towers = [
        [startX,             startY],
        [startX + width - 3, startY],
        [startX,             startY + height - 3],
        [startX + width - 3, startY + height - 3],
      ];
      for (const [tx, ty] of towers) {
        for (let dy = 0; dy < 3; dy++)
          for (let dx = 0; dx < 3; dx++)
            setTile(tx + dx, ty + dy, wall);
        // Центр башни — акцент
        setTile(tx + 1, ty + 1, accent);
      }

      // Ворота — проём по центру нижней стены
      const gateX = startX + Math.floor(width / 2);
      const gateY = startY + height - 1;
      setTile(gateX - 1, gateY, floor);
      setTile(gateX,     gateY, floor);
      setTile(gateX + 1, gateY, floor);

      // Зубцы стен (мерлоны) — через 2 по периметру
      for (let dx = 1; dx < width - 1; dx += 2) {
        setTile(startX + dx, startY, accent);
        setTile(startX + dx, startY + height - 1, accent);
      }
      for (let dy = 1; dy < height - 1; dy += 2) {
        setTile(startX,           startY + dy, accent);
        setTile(startX + width-1, startY + dy, accent);
      }

      // Внутренний двор — донжон в центре если замок большой
      if (width >= 9 && height >= 7) {
        const cx = startX + Math.floor(width / 2);
        const cy = startY + Math.floor(height / 2);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            setTile(cx + dx, cy + dy, dx === 0 && dy === 0 ? accent : wall);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // ДОМ
    // ══════════════════════════════════════════════════════════════
    else if (btype === "house") {
      // Пол
      for (let dy = 1; dy < height - 1; dy++)
        for (let dx = 1; dx < width - 1; dx++)
          setTile(startX + dx, startY + dy, floor);

      // Стены
      for (let dx = 0; dx < width; dx++) {
        setTile(startX + dx, startY,           wall);
        setTile(startX + dx, startY + height-1, wall);
      }
      for (let dy = 1; dy < height-1; dy++) {
        setTile(startX,          startY + dy, wall);
        setTile(startX + width-1, startY + dy, wall);
      }

      // Крыша — верхняя строка акцент
      for (let dx = 0; dx < width; dx++)
        setTile(startX + dx, startY, roof);

      // Дверь по центру нижней стены
      const doorX = startX + Math.floor(width / 2);
      setTile(doorX, startY + height - 1, floor);

      // Окна (если достаточно широко)
      if (width >= 5) {
        setTile(startX + 1, startY + 1, accent);
        setTile(startX + width - 2, startY + 1, accent);
        if (width >= 7) setTile(startX + Math.floor(width/2), startY + 1, accent);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // БАШНЯ
    // ══════════════════════════════════════════════════════════════
    else if (btype === "tower") {
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          const isWall = dx === 0 || dx === width-1 || dy === 0;
          const isFloor = dy === height-1; // нижний уровень — вход
          if (isFloor && dx > 0 && dx < width-1) { setTile(startX+dx, startY+dy, floor); continue; }
          if (isWall) setTile(startX+dx, startY+dy, wall);
          else        setTile(startX+dx, startY+dy, floor);
        }
      }
      // Шпиль / зубцы наверху
      for (let dx = 0; dx < width; dx += 2)
        setTile(startX + dx, startY, accent);
      // Центр верхушки
      setTile(startX + Math.floor(width/2), startY, accent);
      // Бойницы по бокам (через 2 ряда)
      for (let dy = 1; dy < height-2; dy += 2) {
        setTile(startX,          startY+dy, accent);
        setTile(startX + width-1, startY+dy, accent);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // СТЕНА
    // ══════════════════════════════════════════════════════════════
    else if (btype === "wall") {
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          const isTop = dy === 0;
          setTile(startX + dx, startY + dy, isTop ? roof : wall);
        }
      }
      // Зубцы по верху через 2
      for (let dx = 0; dx < width; dx += 2)
        setTile(startX + dx, startY, accent);
      // Ворота по центру
      const mid = startX + Math.floor(width / 2);
      for (let dy = 0; dy < height; dy++)
        setTile(mid, startY + dy, floor);
    }

    // ══════════════════════════════════════════════════════════════
    // ФОЛБЭК — простой прямоугольник
    // ══════════════════════════════════════════════════════════════
    else {
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          const isEdge = dy === 0 || dy === height-1 || dx === 0 || dx === width-1;
          setTile(startX+dx, startY+dy, isEdge ? wall : floor);
        }
      }
    }

    this.repositionPlayerOnWalkable();
    this.cameras.main.shake(250, 0.005);
    this.showFloatingText(
      (startX + Math.floor(width / 2)) * TILE_SIZE,
      (startY - 1) * TILE_SIZE,
      `🏗️ Построено!`
    );
    gameEvents.emit('structure-built', { type, x: startX, y: startY, w: width, h: height });
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
      || tile === "snowball" || tile === "ash" || tile === "board"
      || tile === "sand" as any || tile === "snow" as any || tile === "dirt";
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