import * as Phaser from 'phaser';
import { gameEvents } from './game-events';

// Константы карты
export const MAP_W = 64;
export const MAP_H = 64;
export const TILE_SIZE = 32;

// Типы тайлов (базовые)
export type TileId = "grass" | "water" | "rock" | "tree" | "ruins" | "empty";

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

    // Слушатель события терраформирования от React-чата
    window.addEventListener('ai-terraform', (event: any) => {
      const promptText = event.detail.prompt;
      console.log("Phaser получил команду на терраформирование:", promptText);
      this.terraformMap(promptText);
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
    return tile === "water" || tile === "tree" || tile === "rock" || tile === "ruins";
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
      if (tile !== "empty" && tile !== "water") {
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
    debrisParticle.fillStyle(0x8B737355, 1);
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
  }

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

    // Ломаем только твердые объекты (дерево, камень, руины)
    if (tile === "tree" || tile === "rock" || tile === "ruins") {
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

  // Физическое терраформирование карты с полной заменой тайлов и объектов
  terraformMap(prompt: string) {
    if (!prompt) return;
    const text = prompt.toLowerCase();

    // Определяем биом по ключевым словам
    const isLava = text.includes('лава') || text.includes('вулкан') || text.includes('магма');
    const isDesert = text.includes('песок') || text.includes('пустын');
    const isSnow = text.includes('снег') || text.includes('зим') || text.includes('холод');

    // Определяем новый биом
    let newBiome: BiomeType = "default";
    if (isLava) newBiome = "lava";
    else if (isDesert) newBiome = "desert";
    else if (isSnow) newBiome = "snow";

    // Если ни один биом не распознан - сбрасываем к исходному состоянию
    if (newBiome === "default") {
      console.log("Терраформирование: сброс к исходному состоянию");
      this.currentBiome = "default";
      this.renderTiles(true);
      return;
    }

    console.log("Начинаем физическое терраформирование:", text);

    try {
      // ШАГ 1: ПОЛНЫЙ СБРОС - очищаем все tint, scale и данные перед применением нового биома
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          const idx = y * MAP_W + x;
          if (this.tileSprites[idx]) {
            this.tileSprites[idx].clearTint();
            this.tileSprites[idx].setScale(1);
            this.tileSprites[idx].setData('type', 'default');
            this.tileSprites[idx].setData('biome', 'default');
          }
        }
      }

      // Сохраняем текущий биом
      this.currentBiome = newBiome;

      // ШАГ 2: Применяем новый биом
      // === ЛАВОВЫЙ БИОМ ===
      if (newBiome === "lava") {
        for (let y = 0; y < MAP_H; y++) {
          for (let x = 0; x < MAP_W; x++) {
            const idx = y * MAP_W + x;
            const tile = this.tiles[y][x];
            const sprite = this.tileSprites[idx];
            if (!sprite) continue;

            // Трава заменяется на вулканический камень или магму
            if (tile === "grass") {
              if (Math.random() > 0.3) {
                this.tiles[y][x] = "rock";
                sprite.setTexture("tile-volcanic");
              } else {
                sprite.setTexture("tile-magma");
              }
              sprite.setData('type', 'lava');
              sprite.setData('biome', 'lava');
            }

            // Деревья удаляются, на их месте появляются камни или магма
            if (tile === "tree") {
              if (Math.random() > 0.5) {
                this.tiles[y][x] = "rock";
                sprite.setTexture("tile-volcanic");
              } else {
                sprite.setTexture("tile-magma");
              }
              sprite.setData('type', 'lava');
              sprite.setData('biome', 'lava');
            }

            // Камни и руины получают темный оттенок (обгорелые)
            if (tile === "rock" || tile === "ruins") {
              sprite.setTint(0x444444);
              sprite.setData('type', 'lava');
              sprite.setData('biome', 'lava');
            }
          }
        }

        // Вода окрашивается в красный цвет (лава)
        for (let y = 0; y < MAP_H; y++) {
          for (let x = 0; x < MAP_W; x++) {
            const idx = y * MAP_W + x;
            if (this.tiles[y][x] === "water" && this.tileSprites[idx]) {
              this.tileSprites[idx].setTint(0xff4400);
              this.tileSprites[idx].setData('type', 'lava');
              this.tileSprites[idx].setData('biome', 'lava');
            }
          }
        }
      }

      // === ПУСТЫННЫЙ БИОМ ===
      if (newBiome === "desert") {
        for (let y = 0; y < MAP_H; y++) {
          for (let x = 0; x < MAP_W; x++) {
            const idx = y * MAP_W + x;
            const tile = this.tiles[y][x];
            const sprite = this.tileSprites[idx];
            if (!sprite) continue;

            // Трава заменяется на песок
            if (tile === "grass") {
              sprite.setTexture("tile-sand");
              sprite.setData('type', 'desert');
              sprite.setData('biome', 'desert');
            }

            // Деревья удаляются, случайно заменяются на кактусы
            if (tile === "tree") {
              if (Math.random() > 0.6) {
                sprite.setTexture("tile-cactus");
              } else {
                sprite.setTexture("tile-sand");
              }
              sprite.setData('type', 'desert');
              sprite.setData('biome', 'desert');
            }

            // Камни и руины получают песочный оттенок
            if (tile === "rock" || tile === "ruins") {
              sprite.setTint(0xccbb99);
              sprite.setData('type', 'desert');
              sprite.setData('biome', 'desert');
            }
          }
        }

        // Случайно заспавним кактусы на траве (которая стала песком)
        const cactusCount = Math.floor(Math.random() * 20) + 10;
        for (let i = 0; i < cactusCount; i++) {
          const rx = Math.floor(Math.random() * MAP_W);
          const ry = Math.floor(Math.random() * MAP_H);
          const idx = ry * MAP_W + rx;
          if (this.tiles[ry][rx] === "grass" && this.tileSprites[idx]) {
            this.tileSprites[idx].setTexture("tile-cactus");
            this.tileSprites[idx].setData('type', 'desert');
            this.tileSprites[idx].setData('biome', 'desert');
          }
        }

        // Вода окрашивается в цвет песка (пересохшие водоемы)
        for (let y = 0; y < MAP_H; y++) {
          for (let x = 0; x < MAP_W; x++) {
            const idx = y * MAP_W + x;
            if (this.tiles[y][x] === "water" && this.tileSprites[idx]) {
              this.tileSprites[idx].setTint(0xedc9af);
              this.tileSprites[idx].setData('type', 'desert');
              this.tileSprites[idx].setData('biome', 'desert');
            }
          }
        }
      }

      // === СНЕЖНЫЙ БИОМ ===
      if (newBiome === "snow") {
        for (let y = 0; y < MAP_H; y++) {
          for (let x = 0; x < MAP_W; x++) {
            const idx = y * MAP_W + x;
            const tile = this.tiles[y][x];
            const sprite = this.tileSprites[idx];
            if (!sprite) continue;

            // Трава покрывается снегом
            if (tile === "grass") {
              sprite.setTexture("tile-snow");
              sprite.setData('type', 'snow');
              sprite.setData('biome', 'snow');
            }

            // Деревья заменяются на заснеженные ели
            if (tile === "tree") {
              sprite.setTexture("tile-pine-snow");
              sprite.setData('type', 'snow');
              sprite.setData('biome', 'snow');
            }

            // Камни и руины получают снежный/голубоватый оттенок
            if (tile === "rock" || tile === "ruins") {
              sprite.setTint(0xcce5ff);
              sprite.setData('type', 'snow');
              sprite.setData('biome', 'snow');
            }
          }
        }

        // Вода окрашивается в цвет льда
        for (let y = 0; y < MAP_H; y++) {
          for (let x = 0; x < MAP_W; x++) {
            const idx = y * MAP_W + x;
            if (this.tiles[y][x] === "water" && this.tileSprites[idx]) {
              this.tileSprites[idx].setTint(0x88ccff);
              this.tileSprites[idx].setData('type', 'snow');
              this.tileSprites[idx].setData('biome', 'snow');
            }
          }
        }
      }

      console.log("Терраформирование успешно завершено! Биом:", newBiome);
    } catch (error) {
      console.error("Ошибка при терраформировании:", error);
    }
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
    scene: [MainScene],
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