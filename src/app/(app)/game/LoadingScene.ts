// src/app/(app)/game/LoadingScene.ts
// Экран загрузки FluxCraft — кирпичики летят и собираются в логотип

import * as Phaser from 'phaser';

export class LoadingScene extends Phaser.Scene {
  private blocks: Phaser.GameObjects.Rectangle[] = [];
  private blockTargets: { x: number; y: number }[] = [];
  private progressText!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;
  private subtitleText!: Phaser.GameObjects.Text;
  private progress: number = 0;
  private phase: 'fly_in' | 'assemble' | 'spin' | 'done' = 'fly_in';
  private phaseTimer: number = 0;
  private done: boolean = false;

  constructor() {
    super({ key: 'LoadingScene' });
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    // Тёмный фон с текстурой
    this.add.rectangle(0, 0, W, H, 0x0a0a0a).setOrigin(0, 0);

    // Сетка из точек (как в майнкрафт)
    const g = this.add.graphics();
    g.fillStyle(0x1a1a1a, 1);
    for (let x = 0; x < W; x += 20) {
      for (let y = 0; y < H; y += 20) {
        g.fillRect(x, y, 1, 1);
      }
    }

    // Логотип
    this.titleText = this.add.text(W / 2, H / 2 - 130, 'FLUXCRAFT', {
      fontFamily: '"Courier New", monospace',
      fontSize: '42px',
      fontStyle: 'bold',
      color: '#ff6600',
      stroke: '#000000',
      strokeThickness: 6,
    }).setOrigin(0.5).setAlpha(0);

    this.subtitleText = this.add.text(W / 2, H / 2 - 85, 'AI Game Landscapes', {
      fontFamily: '"Courier New", monospace',
      fontSize: '16px',
      color: '#888888',
    }).setOrigin(0.5).setAlpha(0);

    // Кирпичики — паттерн 5x3 = 15 блоков в центре
    const BLOCK_W = 44;
    const BLOCK_H = 22;
    const GAP = 4;
    const COLS = 5;
    const ROWS = 3;
    const totalW = COLS * (BLOCK_W + GAP) - GAP;
    const totalH = ROWS * (BLOCK_H + GAP) - GAP;
    const startX = W / 2 - totalW / 2;
    const startY = H / 2 - totalH / 2;

    // Цвета кирпичей (оранжевая палитра)
    const colors = [
      0xff6600, 0xff8800, 0xffaa00,
      0xdd4400, 0xff6600, 0xff8800,
      0xffaa00, 0xdd4400, 0xff6600,
      0xff8800, 0xffaa00, 0xdd4400,
      0xff6600, 0xff8800, 0xffaa00,
    ];

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;
        const tx = startX + col * (BLOCK_W + GAP) + BLOCK_W / 2;
        const ty = startY + row * (BLOCK_H + GAP) + BLOCK_H / 2;

        // Стартовая позиция — разлетаются с краёв
        const angle = Math.random() * Math.PI * 2;
        const dist = 400 + Math.random() * 300;
        const sx = W / 2 + Math.cos(angle) * dist;
        const sy = H / 2 + Math.sin(angle) * dist;

        const block = this.add.rectangle(sx, sy, BLOCK_W, BLOCK_H, colors[idx] ?? 0xff6600);
        block.setStrokeStyle(2, 0x000000, 0.8);
        block.setAlpha(0);

        // Добавляем блик на кирпич
        const shine = this.add.rectangle(sx - 8, sy - 4, BLOCK_W - 16, 4, 0xffffff, 0.15);
        shine.setName(`shine_${idx}`);

        this.blocks.push(block);
        this.blockTargets.push({ x: tx, y: ty });
      }
    }

    // Прогресс-бар
    const barW = 280;
    const barH = 8;
    const barY = H / 2 + 90;

    // Фон бара
    this.add.rectangle(W / 2, barY, barW + 4, barH + 4, 0x222222)
      .setStrokeStyle(1, 0x444444);

    // Заливка прогресса
    const barFill = this.add.rectangle(W / 2 - barW / 2, barY, 0, barH, 0xff6600)
      .setOrigin(0, 0.5);

    // Текст прогресса
    this.progressText = this.add.text(W / 2, barY + 20, 'Генерация мира...', {
      fontFamily: '"Courier New", monospace',
      fontSize: '13px',
      color: '#888888',
    }).setOrigin(0.5);

    // Анимация появления логотипа
    this.tweens.add({
      targets: [this.titleText, this.subtitleText],
      alpha: 1,
      y: '-=10',
      duration: 600,
      delay: 100,
      ease: 'Power2',
    });

    // Фаза 1: блоки летят к центру
    this.time.delayedCall(400, () => {
      this.blocks.forEach((block, i) => {
        const target = this.blockTargets[i]!;
        const delay = i * 60 + Math.random() * 100;

        this.tweens.add({
          targets: block,
          x: target.x,
          y: target.y,
          alpha: 1,
          duration: 500 + Math.random() * 200,
          delay,
          ease: 'Back.easeOut',
          onComplete: () => {
            // Небольшой «удар» при приземлении
            this.tweens.add({
              targets: block,
              scaleX: 1.15,
              scaleY: 0.85,
              duration: 80,
              yoyo: true,
              ease: 'Power2',
            });
            this.cameras.main.shake(30, 0.002);
          },
        });
      });
      this.phase = 'assemble';
    });

    // Фаза 2: спустя 2 сек — блоки начинают крутиться кругом
    this.time.delayedCall(2200, () => {
      this.phase = 'spin';
      this.phaseTimer = 0;
    });

    // Анимация прогресса
    this.tweens.addCounter({
      from: 0,
      to: 100,
      duration: 3200,
      ease: 'Sine.easeInOut',
      onUpdate: (tween) => {
        const val = Math.floor(tween.getValue() ?? 0);
        this.progress = val;
        barFill.width = (barW * val) / 100;

        if (val < 30) this.progressText.setText('Инициализация движка...');
        else if (val < 55) this.progressText.setText('Генерация биома...');
        else if (val < 75) this.progressText.setText('Расстановка объектов...');
        else if (val < 90) this.progressText.setText('Загрузка ИИ-модуля...');
        else this.progressText.setText('Почти готово...');
      },
      onComplete: () => {
        this.progressText.setText('Готово! ✓').setColor('#44ff88');
        this.time.delayedCall(400, () => this.finishLoading());
      },
    });

    // Вращение блоков по кругу (фаза spin)
    this.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        if (this.phase !== 'spin' || this.done) return;
        this.phaseTimer += 0.04;
        const cx = W / 2;
        const cy = H / 2;
        const radius = 55;

        this.blocks.forEach((block, i) => {
          const angle = this.phaseTimer + (i / this.blocks.length) * Math.PI * 2;
          const tx = cx + Math.cos(angle) * radius;
          const ty = cy + Math.sin(angle) * radius * 0.45; // эллипс
          block.x += (tx - block.x) * 0.12;
          block.y += (ty - block.y) * 0.12;
          block.setRotation(angle + Math.PI / 2);
        });
      },
    });
  }

  private finishLoading() {
    if (this.done) return;
    this.done = true;
    this.phase = 'done';

    const W = this.scale.width;
    const H = this.scale.height;

    // Финальная анимация — все блоки разлетаются
    this.blocks.forEach((block, i) => {
      const angle = (i / this.blocks.length) * Math.PI * 2;
      this.tweens.add({
        targets: block,
        x: W / 2 + Math.cos(angle) * 600,
        y: H / 2 + Math.sin(angle) * 600,
        alpha: 0,
        scale: 0.3,
        duration: 400,
        delay: i * 20,
        ease: 'Power2.easeIn',
      });
    });

    this.tweens.add({
      targets: [this.titleText, this.subtitleText, this.progressText],
      alpha: 0,
      duration: 300,
      delay: 200,
    });

    // Переходим на главную сцену
    this.time.delayedCall(700, () => {
      this.scene.start('MainScene');
    });
  }
}