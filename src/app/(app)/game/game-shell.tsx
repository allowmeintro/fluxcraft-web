"use client";

import { useState, useCallback, useRef, useEffect, memo } from "react";
import Link from "next/link";
import {
  Send, Save, ImageIcon, Loader2, Brain, Zap, Map, Package,
  Sun, Moon, Sunset, Sunrise, ChevronUp, ChevronDown,
  Trash2, RefreshCw, Hammer, Clock, Globe, Sparkles, Trophy, CheckCircle2, ListChecks
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import PhaserCanvas from "./phaser-canvas";
import { type TileId } from "./phaser-game";
import { gameEvents } from "./game-events";

type MsgMode = "map" | "area" | "objects" | "patch" | "time" | "build" | "clarify" | "error" | "terrain";

type Message = {
  role: "user" | "assistant";
  content: string;
  mode?: MsgMode;
};

type Inventory = Record<string, number>;
type TimeOfDay = "day" | "dusk" | "night" | "dawn";

// ─── СИСТЕМА КВЕСТОВ ───────────────────────────────────────────────────────
type Quest = { 
  id: number; 
  title: string; 
  desc: string; 
  target: number; 
  current: number; 
  completed: boolean; 
  type: "collect" | "terrain" | "build" | "done"; 
  targetId?: string 
};

const INITIAL_QUESTS: Quest[] = [
  { id: 1, title: "Первые шаги", desc: "Добудь 5 блоков дерева (ЛКМ)", target: 5, current: 0, completed: false, type: "collect", targetId: "tree" },
  { id: 2, title: "Шахтёр", desc: "Добудь 5 блоков камня (ЛКМ)", target: 5, current: 0, completed: false, type: "collect", targetId: "rock" },
  { id: 3, title: "Магия ИИ", desc: "Напиши в чат: «Сделай пустыню»", target: 1, current: 0, completed: false, type: "terrain", targetId: "desert" },
  { id: 4, title: "Архитектор", desc: "Попроси ИИ: «Построй дом 5 на 5»", target: 1, current: 0, completed: false, type: "build" },
  { id: 5, title: "Мастер песочницы", desc: "Все квесты выполнены! Твори свободно.", target: 1, current: 1, completed: true, type: "done" }
];

// ─── ГИБКАЯ ПРОВЕРКА КОНТЕКСТА ─────────────────────────────────────────────
/** Проверяет, содержит ли текст хотя бы одно из ключевых слов/корней */
function hasAnyWord(text: string, ...words: string[]): boolean {
  const t = text.toLowerCase();
  return words.some(w => t.includes(w.toLowerCase()));
}

/** Проверяет, соответствует ли текст ландшафтному запросу (биом/террейн) */
function isTerrainRequest(text: string): boolean {
  const t = text.toLowerCase();
  const terrainHints = [
    "сделай", "преврати", "биом", "хочу", "сгенер",
    "снег", "зим", "лёд", "лед", "мороз", "тундр",
    "пустын", "песок", "сахар", "бархан", "засух",
    "лав", "вулкан", "магм", "огонь", "пекл",
    "лес", "рощ", "дерев", "болот", "джунг",
    "мифическ", "кристалл",
    "снежный", "пустыня", "лавы", "вулканический",
  ];
  return terrainHints.some(hint => t.includes(hint));
}

/** Проверяет, является ли текст командой на стройку */
function isBuildRequest(text: string): boolean {
  const t = text.toLowerCase();
  const buildHints = [
    "построй", "построить", "постройте", "возведи",
    "строить", "сооруди", "здание", "дом", "замок",
    "башня", "крепост", "стен", "мост",
    "build", "construct", "building",
  ];
  return buildHints.some(hint => t.includes(hint));
}

/** Проверяет, является ли текст запросом на смену времени */
function isTimeRequest(text: string): boolean {
  const t = text.toLowerCase();
  const timeHints = ["ночь", "день", "закат", "рассвет", "вечер", "утро", "темно"];
  return (timeHints.some(h => t.includes(h)) || timeHints.some(h => t === h)) &&
    (t.includes("сделай") || t.includes("наступ") || timeHints.some(h => t === h));
}

/** Проверяет, является ли текст патч-командой (замена блоков) */
function isPatchRequest(text: string): boolean {
  const t = text.toLowerCase();
  const patchHints = [
    "замен", "поменя", "убери", "удал", "вмест",
    "очист", "расстав", "добав", "постав",
  ];
  return patchHints.some(h => t.startsWith(h));
}

// ─── Словарь предметов ─────────────────────────────────────────────────────
const ITEM_NAMES: Record<string, string> = {
  // Базовые
  grass: "Трава", rock: "Камень", tree: "Дерево", ruins: "Руины", water: "Вода",
  // Снежный биом
  grass_snow: "Снеж. трава", rock_snow: "Снеж. камень",
  tree_snow: "Снеж. ель", ruins_snow: "Снеж. руины",
  // Лавовый биом
  grass_magma: "Магм. порода", rock_magma: "Вулк. камень",
  tree_magma: "Уголь", ruins_magma: "Обугл. руины",
  // Пустынный биом
  grass_sand: "Песок", rock_sand: "Песч. камень",
  tree_sand: "Кактус", ruins_sand: "Руины пустыни",
  // Специальные объекты
  ice: "🧊 Лёд",
  snowball: "⚪ Снежком",
  frozen_lake: "❄️ Замёрзш. озеро",
  mythic_grass: "✨ Миф. трава",
  mythic_rock: "💜 Миф. камень",
  crystal: "💎 Кристалл",
  quartz: "🔮 Кварц",
  board: "🪵 Доска",
  glass: "🪟 Стекло",
  concrete: "🧱 Бетон",
  plant: "🌿 Растение",
  glowing_mushroom: "💡 Светогриб",
  ash: "💨 Пепел",
  coral: "🪸 Коралл",
  tnt: "💥 Динамит",
  dirt: "🟫 Грязь",
  mushroom: "🍄 Гриб",
  bog: "🌊 Болото",
  // Биомные вариации специальных объектов
  ice_snow: "🧊 Снеж. лёд",
  crystal_snow: "💎 Снеж. кристалл",
  mythic_rock_snow: "💜 Снеж. миф. камень",
  quartz_snow: "🔮 Снеж. кварц",
  ash_magma: "💨 Вулк. пепел",
  coral_magma: "🪸 Вулк. коралл",
  plant_magma: "🌿 Обугл. растение",
  quartz_sand: "🔮 Песч. кварц",
  crystal_sand: "💎 Песч. кристалл",
};

// Получить русское название для любого ключа инвентаря
function getItemName(id: string): string {
  if (ITEM_NAMES[id]) return ITEM_NAMES[id];
  // Попробуем по базовой части (до первого _)
  const base = id.split('_')[0];
  if (ITEM_NAMES[base]) {
    // Добавим биомный суффикс
    const suffix = id.slice(base.length + 1);
    const sfxLabel: Record<string, string> = { snow: "❄️", magma: "🌋", sand: "🏜️", };
    return (sfxLabel[suffix] ?? "") + " " + ITEM_NAMES[base];
  }
  // Последний фолбэк — красиво форматируем английский ключ
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getItemColor(id: string): string {
  if (id === "crystal")          return "bg-blue-900 border border-blue-400";
  if (id === "mythic_rock")      return "bg-purple-950 border border-purple-500";
  if (id === "mythic_grass")     return "bg-purple-800 border border-purple-400";
  if (id === "glowing_mushroom") return "bg-cyan-900 border border-cyan-400";
  if (id === "ice" || id === "frozen_lake") return "bg-sky-200 border border-sky-300";
  if (id === "quartz")           return "bg-pink-100 border border-pink-300";
  if (id === "glass")            return "bg-sky-100 border border-sky-200";
  if (id === "concrete")         return "bg-gray-400 border border-gray-500";
  if (id === "board")            return "bg-amber-700 border border-amber-600";
  if (id === "plant")            return "bg-green-600 border border-green-500";
  if (id === "snowball")         return "bg-white border border-blue-100";
  if (id === "ash")              return "bg-gray-700 border border-gray-600";
  if (id === "coral")            return "bg-orange-500 border border-orange-400";
  if (id === "tnt")              return "bg-red-700 border border-red-400";
  if (id === "dirt")             return "bg-amber-900 border border-amber-800";
  if (id.includes("snow"))       return "bg-blue-100 border border-blue-200";
  if (id.includes("magma"))      return "bg-red-950 border border-red-800";
  if (id.includes("sand"))       return "bg-yellow-200 border border-yellow-300";
  if (id === "tree")             return "bg-green-700";
  if (id === "rock")             return "bg-zinc-500";
  if (id === "ruins")            return "bg-zinc-600";
  return "bg-green-600";
}

// ─── Быстрые команды ───────────────────────────────────────────────────────
const QUICK_COMMANDS = [
  { label: "❄️ Снег",     prompt: "снежный лес с горными вершинами" },
  { label: "🌋 Лава",     prompt: "вулканический остров с лавой и руинами" },
  { label: "🏜️ Пустыня", prompt: "пустыня с оазисом и древними храмами" },
  { label: "✨ Мифика",   prompt: "мифический лес с кристаллами и руинами" },
  { label: "🌿 Болото",   prompt: "болотный биом с туманом и грибами" },
  { label: "🏙️ Город",   prompt: "заброшенный город с дорогами и зданиями" },
  { label: "☀️ День",     prompt: "QUICK_TIME:day" },
  { label: "🌙 Ночь",     prompt: "QUICK_TIME:night" },
  { label: "🌅 Закат",    prompt: "QUICK_TIME:dusk" },
  { label: "🌄 Рассвет",  prompt: "QUICK_TIME:dawn" },
];

const BIOME_LABELS: Record<string, string> = {
  snow: "❄️ Снежный", lava: "🌋 Лавовый", desert: "🏜️ Пустынный",
  forest: "🌲 Лесной", city: "🏙️ Городской", swamp: "🌿 Болотный",
  mythic: "✨ Мифический", default: "🌿 Луговой",
};

const TIME_ICONS: Record<TimeOfDay, React.ReactNode> = {
  day:  <Sun className="w-3 h-3" />,
  dusk: <Sunset className="w-3 h-3" />,
  night:<Moon className="w-3 h-3" />,
  dawn: <Sunrise className="w-3 h-3" />,
};

// ─── АНИМИРОВАННЫЙ ФОН ─────────────────────────────────────────────────────
const AnimatedBackground = memo(function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let t = 0;

    // Частицы
    type Particle = { x: number; y: number; vx: number; vy: number; size: number; alpha: number; hue: number; pulse: number };
    const particles: Particle[] = [];

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Инициализируем частицы
    for (let i = 0; i < 120; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -Math.random() * 0.6 - 0.1,
        size: Math.random() * 2.5 + 0.5,
        alpha: Math.random(),
        hue: Math.random() > 0.7 ? 38 : 22, // оранжевый / тёмно-оранжевый
        pulse: Math.random() * Math.PI * 2,
      });
    }

    const draw = () => {
      t += 0.008;
      const W = canvas.width;
      const H = canvas.height;

      ctx.clearRect(0, 0, W, H);

      // ── 1. ПУЛЬСИРУЮЩИЙ РАДИАЛЬНЫЙ ГРАДИЕНТ ──
      const cx = W / 2 + Math.sin(t * 0.5) * W * 0.08;
      const cy = H / 2 + Math.cos(t * 0.4) * H * 0.06;
      const r1 = Math.min(W, H) * (0.45 + Math.sin(t * 0.7) * 0.08);
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r1);
      grd.addColorStop(0,   `rgba(234,88,12,${0.06 + Math.sin(t) * 0.03})`);
      grd.addColorStop(0.5, `rgba(180,50,0,${0.03 + Math.sin(t * 1.3) * 0.015})`);
      grd.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);

      // ── 2. ДВИЖУЩАЯСЯ СЕТКА (Tron-стиль) ──
      const CELL = 36;
      const gridAlpha = 0.07 + Math.sin(t * 0.6) * 0.025;
      ctx.save();
      ctx.strokeStyle = `rgba(234,88,12,${gridAlpha})`;
      ctx.lineWidth = 0.5;
      const ox = ((t * 8) % CELL);
      const oy = ((t * 5) % CELL);
      for (let x = -CELL + ox; x < W + CELL; x += CELL) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = -CELL + oy; y < H + CELL; y += CELL) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.restore();

      // ── 3. ВОЛНЫ ЭНЕРГИИ (горизонтальные) ──
      for (let w = 0; w < 3; w++) {
        const wt = t * (0.4 + w * 0.15) + w * 2.1;
        const wy = H * (0.3 + w * 0.2) + Math.sin(wt * 0.8) * H * 0.07;
        const wAlpha = 0.04 + Math.sin(wt) * 0.02;
        ctx.save();
        ctx.strokeStyle = `rgba(251,146,60,${wAlpha})`;
        ctx.lineWidth = 1.5 - w * 0.3;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const y = wy + Math.sin((x / W) * Math.PI * 4 + wt * 1.5) * 18
                      + Math.sin((x / W) * Math.PI * 7 + wt * 0.8) * 8;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // ── 4. ДИАГОНАЛЬНЫЕ СВЕТОВЫЕ ЛУЧИ ──
      for (let r = 0; r < 4; r++) {
        const rt = t * 0.15 + r * (Math.PI / 2);
        const startX = W * 0.5 + Math.cos(rt) * W * 0.6;
        const startY = H * 0.5 + Math.sin(rt) * H * 0.6;
        const endX = W * 0.5 - Math.cos(rt) * W * 0.3;
        const endY = H * 0.5 - Math.sin(rt) * H * 0.3;
        const rAlpha = (0.02 + Math.sin(rt * 2) * 0.01) * (r < 2 ? 1 : 0.5);
        const rGrd = ctx.createLinearGradient(startX, startY, endX, endY);
        rGrd.addColorStop(0, "rgba(0,0,0,0)");
        rGrd.addColorStop(0.5, `rgba(234,88,12,${rAlpha})`);
        rGrd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.save();
        ctx.strokeStyle = rGrd;
        ctx.lineWidth = 60 + r * 20;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.restore();
      }

      // ── 5. ЧАСТИЦЫ-ИСКРЫ ──
      for (const p of particles) {
        p.x += p.vx + Math.sin(t + p.pulse) * 0.15;
        p.y += p.vy;
        p.pulse += 0.02;
        p.alpha += 0.008;
        if (p.y < -10 || p.alpha > 1.2) {
          p.x = Math.random() * W;
          p.y = H + 10;
          p.alpha = 0;
          p.vy = -Math.random() * 0.6 - 0.1;
          p.vx = (Math.random() - 0.5) * 0.4;
        }
        const a = Math.min(p.alpha, 1) * (0.4 + Math.sin(p.pulse) * 0.3);
        if (a <= 0) continue;
        ctx.save();
        ctx.globalAlpha = a;
        // Ядро частицы
        ctx.fillStyle = `hsl(${p.hue}, 95%, 65%)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // Свечение вокруг
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);
        glow.addColorStop(0, `hsla(${p.hue}, 95%, 65%, 0.4)`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ── 6. УГЛОВЫЕ АКЦЕНТЫ ──
      const corners = [[0,0],[W,0],[0,H],[W,H]];
      corners.forEach(([cx2, cy2], i) => {
        const cAlpha = 0.05 + Math.sin(t * 0.8 + i) * 0.03;
        const cGrd = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, Math.min(W,H) * 0.3);
        cGrd.addColorStop(0, `rgba(234,88,12,${cAlpha})`);
        cGrd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = cGrd;
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
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
});

// ─── КОМПОНЕНТ ─────────────────────────────────────────────────────────────
export function GameShell() {
  const [gameMode, setGameMode]     = useState<"free" | "quest">("free");
  const [quests, setQuests]         = useState<Quest[]>(INITIAL_QUESTS);
  const [questPopup, setQuestPopup] = useState<string | null>(null);

  const [inventory, setInventory]   = useState<Inventory>({});
  const [selected, setSelected]     = useState<string>("grass");
  const [currentTime, setCurrentTime] = useState<TimeOfDay>("day");
  const [worldBiome, setWorldBiome] = useState<string>("default");
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [showQuick, setShowQuick]   = useState(true);
  const [tab, setTab]               = useState<"inventory" | "stats">("inventory");
  
  const selectedRef = useRef<string>("grass");
  const chatEndRef  = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLInputElement>(null);

  const [messages, setMessages] = useState<Message[]>([{
    role: "assistant",
    content: "Привет! Я ИИ FluxCraft (Llama 3.3 via Groq).\n\nНажми быструю команду или напиши:\n• «Снежный лес с руинами» — новый мир\n• «Построй замок» — стройка (спрошу детали)\n• «Поставь рядом со мной кристаллы»\n• «Замени камни на лёд» — точечный патч\n• «Ночь» / «Закат» — смена времени",
    mode: "map",
  }]);
  const [input, setInput]           = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showQuestList, setShowQuestList] = useState(false);

  // Читаем режим игры из URL
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("mode") === "quest") setGameMode("quest");
    }
  }, []);

  const activeQuest = quests.find(q => !q.completed) || quests[quests.length - 1];
  const completedQuests = quests.filter(q => q.completed && q.id !== 5);
  const totalQuests = quests.filter(q => q.id !== 5).length;
  const doneCount = completedQuests.length;
  const allDone = doneCount >= totalQuests;

  // 1. Отслеживание добычи блоков для квестов
  useEffect(() => {
    if (gameMode !== "quest") return;
    const onCollect = (data: any) => {
      setQuests(prev => {
        const newQuests = [...prev];
        const currentIdx = newQuests.findIndex(q => !q.completed);
        if (currentIdx === -1) return prev;
        
        const q = newQuests[currentIdx];
        if (q.type === "collect" && (data.baseId === q.targetId || data.type === q.targetId)) {
          q.current += data.amount;
          if (q.current >= q.target) {
            q.current = q.target;
            q.completed = true;
            triggerQuestPopup(q.title);
          }
          return newQuests;
        }
        return prev;
      });
    };
    gameEvents.on('block-collected', onCollect);
    return () => gameEvents.off('block-collected', onCollect);
  }, [gameMode]);

  // Вызов попапа при выполнении квеста
  const triggerQuestPopup = (title: string) => {
    setQuestPopup(title);
    setTimeout(() => setQuestPopup(null), 4000);
  };

  // 2. Отслеживание действий ИИ для квестов — ГИБКАЯ ВЕРСИЯ
  const advanceAiQuest = useCallback((type: "terrain" | "build", promptText: string) => {
    if (gameMode !== "quest") return;
    setQuests(prev => {
      const newQuests = [...prev];
      const currentIdx = newQuests.findIndex(q => !q.completed);
      if (currentIdx === -1) return prev;
      
      const q = newQuests[currentIdx];
      let advance = false;

      if (q.type === "terrain" && type === "terrain") {
        const t = promptText.toLowerCase();
        // Квест на пустыню (id=3): срабатывает на любые упоминания пустыни/песка
        if (q.targetId === "desert") {
          advance = hasAnyWord(t, "пустын", "песок", "сахар", "бархан", "арид", "засух", "кактус");
        } else {
          // Любой другой террейн-квест
          advance = isTerrainRequest(t);
        }
      } else if (q.type === "build" && type === "build") {
        // Квест на стройку: любая build-команда засчитывает
        advance = true;
      }

      if (advance) {
        q.current = q.target;
        q.completed = true;
        triggerQuestPopup(q.title);
        return newQuests;
      }
      return prev;
    });
  }, [gameMode]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating]);

  // Слушаем смену времени из Phaser
  useEffect(() => {
    const onTime = () => {
      const t = (window as any).__currentTime as TimeOfDay;
      if (t) setCurrentTime(t);
    };
    const iv = setInterval(onTime, 5000);
    return () => clearInterval(iv);
  }, []);

  const handleSelect = useCallback((id: string) => {
    selectedRef.current = id;
    setSelected(id);
  }, []);

  const getSelectedTile = useCallback((): TileId => {
    const item = selectedRef.current;
    const ALL_PLACEABLE: TileId[] = [
      "grass","water","rock","tree","ruins","empty",
      "ice","mythic_grass","mythic_rock","crystal","snowball","frozen_lake",
      "quartz","board","glass","concrete","plant","glowing_mushroom","ash","coral",
      "tnt","dirt",
    ];
    if (ALL_PLACEABLE.includes(item as TileId)) return item as TileId;
    const base = item.split("_")[0] as TileId;
    return ALL_PLACEABLE.includes(base) ? base : "grass";
  }, []);

  const getSelectedItem = useCallback((): string => selectedRef.current, []);
  const handleInventory = useCallback((inv: Inventory) => setInventory(inv), []);

  const totalItems = Object.values(inventory).reduce((a, b) => a + b, 0);

  const applyTime = useCallback((time: TimeOfDay) => {
    window.dispatchEvent(new CustomEvent("ai-set-time", { detail: { time } }));
    setCurrentTime(time);
    const labels = { day: "☀️ День!", dusk: "🌅 Закат...", night: "🌙 Ночь!", dawn: "🌄 Рассвет!" };
    setMessages(prev => [...prev, { role: "assistant", content: labels[time], mode: "time" }]);
  }, []);

  const handleAiResponse = useCallback(async (data: any, userText: string) => {
    // Отладка: логируем что пришло от сервера
    console.log("[AI Response]", JSON.stringify(data).slice(0, 300));

    switch (data.command) {
      case "generate_map":
        {
          const map = data.map;
          if (Array.isArray(map) && map.length > 0) {
            window.dispatchEvent(new CustomEvent("ai-map-generated", { detail: { biome: data.biome, map } }));
            setWorldBiome(data.biome ?? "default");
            setMessages(prev => [...prev, {
              role: "assistant",
              content: `🗺️ ${data.description ?? "Карта создана"}\n\nБиом: ${BIOME_LABELS[data.biome] ?? data.biome}`,
              mode: "map",
            }]);
            advanceAiQuest("terrain", userText);
          } else {
            // Карта не пришла — пробуем через biome
            const biome = data.biome ?? "default";
            window.dispatchEvent(new CustomEvent("ai-patch-map", { detail: { biome } }));
            setWorldBiome(biome);
            setMessages(prev => [...prev, {
              role: "assistant",
              content: `🗺️ ${data.description ?? "Смена биома"}\n\nБиом: ${BIOME_LABELS[biome] ?? biome}`,
              mode: "map",
            }]);
            advanceAiQuest("terrain", userText);
          }
        }
        break;

      case "patch_tiles":
        if (data.from && data.to) {
          window.dispatchEvent(new CustomEvent("ai-patch-tiles", { detail: { from: data.from, to: data.to } }));
          setMessages(prev => [...prev, {
            role: "assistant",
            content: `🎨 ${data.description ?? "Тайлы заменены по всей карте"}\n[${data.from}] → [${data.to}]`,
            mode: "area",
          }]);
        }
        break;

      case "modify_area":
        if (Array.isArray(data.changes)) {
          window.dispatchEvent(new CustomEvent("ai-modify-area", { detail: { changes: data.changes } }));
          setMessages(prev => [...prev, {
            role: "assistant",
            content: `⚡ ${data.description ?? "Зона изменена"}\nТайлов: ${data.changes.length}`,
            mode: "area",
          }]);
        }
        break;

      case "place_objects":
        if (Array.isArray(data.objects)) {
          window.dispatchEvent(new CustomEvent("ai-place-objects", { detail: { objects: data.objects } }));
          setMessages(prev => [...prev, {
            role: "assistant",
            content: `📦 ${data.description ?? "Объекты размещены"}\nКоличество: ${data.objects.length}`,
            mode: "objects",
          }]);
        }
        break;

      case "build":
        {
          const playerPos = (window as any).__playerPosition as { x: number; y: number } | undefined;
          const px = playerPos?.x ?? 32;
          const py = playerPos?.y ?? 32;
          const bw = Math.min(data.width ?? 5, 30);
          const bh = Math.min(data.height ?? 5, 30);
          const btype = data.type ?? "house";
          const bmat  = data.material ?? data.tile ?? "rock";
          // Центрируем постройку относительно игрока, выше него
          const MAP_W = 64, MAP_H = 64;
          const bx = Math.max(0, Math.min(MAP_W - bw, px - Math.floor(bw / 2)));
          const by = Math.max(0, Math.min(MAP_H - bh, py - Math.floor(bh / 2)));
          window.dispatchEvent(new CustomEvent("ai-build-structure", {
            detail: { type: btype, structure: bmat, x: bx, y: by, width: bw, height: bh }
          }));
          const typeLabels: Record<string, string> = {
            castle: "🏰 Замок", house: "🏠 Дом", tower: "🗼 Башня", wall: "🧱 Стена", fort: "⚔️ Форт"
          };
          setMessages(prev => [...prev, {
            role: "assistant",
            content: `🏗️ ${typeLabels[btype] ?? "Постройка"} ${bw}×${bh} из ${bmat}\n${data.description ?? ""}`,
            mode: "build",
          }]);
          advanceAiQuest("build", userText);
        }
        break;

      case "set_time":
        applyTime((data.value ?? "day") as TimeOfDay);
        break;

      case "clarify":
        {
          const exArr = Array.isArray(data.examples) && data.examples.length ? data.examples : [];
          const ex = exArr.length ? "\n\nНапример:\n" + exArr.map((e: string) => `• ${e}`).join("\n") : "";
          setMessages(prev => [...prev, {
            role: "assistant",
            content: `🤔 ${data.question}${ex}`,
            mode: "clarify",
          }]);
          // Добавляем кнопки быстрого выбора из примеров
          if (exArr.length > 0) {
            setMessages(prev => [...prev, {
              role: "assistant",
              content: "__CLARIFY_BUTTONS__:" + exArr.join("|"),
              mode: "clarify",
            }]);
          }
        }
        break;

      default:
        console.warn("[AI] Неизвестный command:", data.command, "| ответ:", JSON.stringify(data).slice(0, 400));
        if (Array.isArray(data.map) && data.map.length > 0) {
          window.dispatchEvent(new CustomEvent("ai-map-generated", { detail: { biome: data.biome ?? "default", map: data.map } }));
          setWorldBiome(data.biome ?? "default");
          setMessages(prev => [...prev, { role: "assistant", content: `🗺️ ${data.description ?? "Карта сгенерирована"}`, mode: "map" }]);
          advanceAiQuest("terrain", userText);
        } else if (data.biome) {
          window.dispatchEvent(new CustomEvent("ai-patch-map", { detail: { biome: data.biome } }));
          setWorldBiome(data.biome);
          setMessages(prev => [...prev, { role: "assistant", content: `🗺️ ${data.description ?? "Биом: " + data.biome}`, mode: "map" }]);
          advanceAiQuest("terrain", userText);
        } else if (data.type && (data.width || data.height)) {
          const playerPos = (window as any).__playerPosition as { x: number; y: number } | undefined;
          const px = playerPos?.x ?? 32; const py = playerPos?.y ?? 32;
          const bw = Math.min(data.width ?? 5, 30); const bh = Math.min(data.height ?? 5, 30);
          const bx = Math.max(0, Math.min(64 - bw, px - Math.floor(bw / 2)));
          const by = Math.max(0, Math.min(64 - bh, py - Math.floor(bh / 2)));
          window.dispatchEvent(new CustomEvent("ai-build-structure", {
            detail: { type: data.type ?? "house", structure: data.material ?? "rock", x: bx, y: by, width: bw, height: bh }
          }));
          setMessages(prev => [...prev, { role: "assistant", content: `🏗️ ${data.description ?? "Постройка возведена"}`, mode: "build" }]);
        } else {
          setMessages(prev => [...prev, { role: "assistant", content: `⚠️ Не понял команду. Попробуй: «снежный лес», «построй замок», «замени траву на снег».`, mode: "error" }]);
        }
    }
  }, [applyTime, advanceAiQuest]);

  // ── ЛОКАЛЬНЫЙ ПЕРЕХВАТ «ДОБАВЬ В ИНВЕНТАРЬ» ──────────────────────────────
  // Словарь: ключевые слова → TileId для выдачи в инвентарь
  // ── ЛОКАЛЬНЫЙ ПЕРЕХВАТ «ДОБАВЬ В ИНВЕНТАРЬ» ──────────────────────────────
  // Словарь корней/подстрок → TileId. Порядок важен — длинные раньше коротких!
  const GIVE_ROOTS: Array<[string, string]> = [
    // Двухсловные (приоритет — раньше однословных)
    ["снежный ком",    "snowball"],
    ["снежных комков", "snowball"],
    ["снежных кома",   "snowball"],
    ["снежных ком",    "snowball"],
    ["снежный шар",    "snowball"],
    ["замёрзш",        "frozen_lake"],
    ["замерзш",        "frozen_lake"],
    ["frozen lake",    "frozen_lake"],
    ["светогриб",      "glowing_mushroom"],
    ["миф. камень",    "mythic_rock"],
    ["мифическ",       "mythic_grass"],
    // Однокорневые
    ["кристалл",  "crystal"],
    ["кварц",     "quartz"],
    ["бетон",     "concrete"],
    ["стекл",     "glass"],
    ["доск",      "board"],
    ["растени",   "plant"],
    ["гриб",      "glowing_mushroom"],
    ["пепел",     "ash"],
    ["пепла",     "ash"],
    ["коралл",    "coral"],
    ["динамит",   "tnt"],
    ["тнт",       "tnt"],
    ["взрывч",    "tnt"],
    ["грязь",     "dirt"],
    ["грязи",     "dirt"],
    ["грязн",     "dirt"],
    ["магм",      "mythic_rock"],
    ["лава",      "ice"],
    ["руин",      "ruins"],
    ["камен",     "rock"],
    ["камн",      "rock"],
    ["дерев",     "tree"],
    ["трав",      "grass"],
    ["снежком",   "snowball"],
    ["снежк",     "snowball"],
    ["снег",      "snowball"],
    ["лёд",       "ice"],
    ["лед",       "ice"],
    ["льд",       "ice"],
  ];

  /** Пробуем обработать запрос «добавь X в инвентарь» локально.
   *  Возвращает true если обработали, false — нужно слать в AI. */
  const tryGiveInventory = useCallback((text: string): boolean => {
    const t = text.toLowerCase();

    // Триггеры на выдачу в инвентарь (без размещения на карте)
    const isGive = (
      (t.includes("добавь") || t.includes("дай") || t.includes("выдай") ||
       t.includes("кинь") || t.includes("дать") || t.includes("получить") ||
       t.includes("хочу") || t.includes("положи") || t.includes("дайте")) &&
      !t.includes("рядом со мной") && !t.includes("поставь рядом") &&
      !t.includes("построй") && !t.includes("вокруг меня") &&
      // Не биомный запрос: не содержит биомных слов
      !/(снежн|лавов|пустын|мифич|болотн|лесн|замени|заменяй|биом|карт|мир)/.test(t)
    );
    if (!isGive) return false;

    // Ищем количество (числа 1–99), включая слова "пару", "несколько"
    const numMatch = t.match(/\b(\d{1,2})\b/);
    let amount = numMatch ? Math.min(parseInt(numMatch[1]), 64) : 1;
    if (t.includes("пару") || t.includes("два") || t.includes("две")) amount = 2;
    if (t.includes("тройк") || t.includes("три")) amount = 3;
    if (t.includes("несколько") || t.includes("немного")) amount = 5;

    // Ищем предмет по корням (первое совпадение побеждает)
    let foundTile: string | null = null;
    for (const [root, tile] of GIVE_ROOTS) {
      if (t.includes(root)) { foundTile = tile; break; }
    }

    if (!foundTile) return false;

    // Выдаём через событие Phaser
    window.dispatchEvent(new CustomEvent("ai-give-items", { detail: { tile: foundTile, amount } }));
    const itemLabel = ITEM_NAMES[foundTile] ?? foundTile;
    setMessages(prev => [...prev, {
      role: "assistant",
      content: `📦 выдать ${itemLabel}\nКоличество: ${amount}`,
      mode: "objects",
    }]);
    return true;
  }, []);

  const handleSend = useCallback(async (overrideText?: string) => {
    const userText = (overrideText ?? input).trim();
    if (!userText || isGenerating) return;

    if (userText.startsWith("QUICK_TIME:")) {
      applyTime(userText.replace("QUICK_TIME:", "") as TimeOfDay);
      return;
    }

    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userText }]);
    setCmdHistory(prev => [userText, ...prev.slice(0, 49)]);
    setHistoryIdx(-1);

    // Быстрая локальная обработка только для времени суток (не требует AI)
    if (isTimeRequest(userText)) {
      const t = userText.toLowerCase();
      const time: TimeOfDay = t.includes("ночь") ? "night" : t.includes("закат") ? "dusk" : t.includes("рассвет") ? "dawn" : "day";
      applyTime(time);
      return;
    }

    // Локальная обработка выдачи предметов в инвентарь (без AI и без карты)
    if (tryGiveInventory(userText)) return;

    // Все остальные запросы (биомы, стройка, патчи, уточнения) — через AI
    setIsGenerating(true);
    try {
      const playerPos = (window as any).__playerPosition as { x: number; y: number } | undefined;
      const isPlace = userText.toLowerCase().includes("рядом со мной") || userText.toLowerCase().includes("около меня") || userText.toLowerCase().includes("вокруг меня");

      const res = await fetch("/api/game-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userText,
          playerX: playerPos?.x ?? 32,
          playerY: playerPos?.y ?? 32,
          isPlaceCommand: isPlace,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      await handleAiResponse(data, userText);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `⚠️ Ошибка соединения с сервером.\nПопробуй ещё раз или используй быстрые команды.`,
        mode: "error",
      }]);
    } finally {
      setIsGenerating(false);
    }
  }, [input, isGenerating, handleAiResponse, applyTime, advanceAiQuest]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { handleSend(); return; }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(historyIdx + 1, cmdHistory.length - 1);
      setHistoryIdx(next);
      if (cmdHistory[next]) setInput(cmdHistory[next]);
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(historyIdx - 1, -1);
      setHistoryIdx(next);
      setInput(next === -1 ? "" : cmdHistory[next] ?? "");
    }
  }, [handleSend, historyIdx, cmdHistory]);

  const clearChat = useCallback(() => {
    setMessages([{ role: "assistant", content: "Чат очищен. Пиши команды!", mode: "map" }]);
  }, []);

  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden relative">

      {/* ── АНИМИРОВАННЫЙ ФОН ── */}
      <AnimatedBackground />

      {/* --- ПОПАП ВЫПОЛНЕНИЯ КВЕСТА (эпичный bounce-in) --- */}
      {questPopup && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 bg-gradient-to-r from-orange-600 to-orange-500 text-white px-8 py-4 rounded-full font-bold shadow-[0_0_40px_rgba(234,88,12,0.8)] z-[100] animate-bounce flex items-center gap-3 border-2 border-yellow-400 pointer-events-none">
          <CheckCircle2 className="w-6 h-6 text-yellow-300 animate-pulse" />
          <span>Квест выполнен: {questPopup}!</span>
        </div>
      )}

      {/* --- ПОПАП ВСЕ КВЕСТЫ ВЫПОЛНЕНЫ --- */}
      {gameMode === "quest" && allDone && !questPopup && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 bg-emerald-600 text-white px-6 py-3 rounded-full font-bold shadow-[0_0_30px_rgba(16,185,129,0.6)] z-[100] flex items-center gap-3 border-2 border-emerald-400 pointer-events-none animate-fade-in">
          <Trophy className="w-6 h-6 text-yellow-300" />
          <span>🏆 Все квесты выполнены! Твори свободно.</span>
        </div>
      )}

      {/* ── Canvas ─────────────────────────────────────────────── */}
      <div className="flex-1 relative">
        <PhaserCanvas getSelectedTile={getSelectedTile} getSelectedItem={getSelectedItem} onInventory={handleInventory} />

        {/* --- ПАНЕЛЬ ТЕКУЩЕГО КВЕСТА (upper-left, glassmorphism) --- */}
        {gameMode === "quest" && activeQuest.type !== "done" && (
          <div className="absolute top-16 left-4 bg-zinc-950/70 backdrop-blur-xl border border-orange-500/40 rounded-xl p-4 shadow-[0_0_25px_rgba(234,88,12,0.15)] z-20 w-72 pointer-events-none">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-orange-400" />
                <h3 className="font-bold text-sm text-orange-100 uppercase tracking-wide">
                  {activeQuest.title}
                </h3>
              </div>
              <span className="text-[10px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
                {doneCount}/{totalQuests}
              </span>
            </div>
            <p className="text-sm text-zinc-300 mb-3 font-medium">{activeQuest.desc}</p>
            <div className="w-full bg-zinc-800 rounded-full h-3 mb-1 overflow-hidden">
              <div 
                className="bg-gradient-to-r from-orange-500 to-yellow-400 h-full transition-all duration-700 ease-out rounded-full" 
                style={{ width: `${(activeQuest.current / activeQuest.target) * 100}%` }}
              >
                <div className="h-full w-full bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.15)_50%,transparent_100%)] animate-shimmer" />
              </div>
            </div>
            <div className="flex justify-between text-[11px] text-zinc-400 font-mono font-bold">
              <span>Прогресс</span>
              <span className="text-orange-300">{activeQuest.current} / {activeQuest.target}</span>
            </div>
          </div>
        )}

        {/* --- ПАНЕЛЬ ВСЕХ КВЕСТОВ (слева, с эффектом стекла) --- */}
        {gameMode === "quest" && (
          <div className="absolute top-[200px] left-4 z-20 pointer-events-auto">
            <button
              onClick={() => setShowQuestList(v => !v)}
              className="flex items-center gap-2 px-3 py-1.5 bg-zinc-950/70 backdrop-blur-md border border-orange-500/40 rounded-lg text-xs text-orange-300 hover:bg-orange-500/10 hover:border-orange-500/60 transition-all duration-300"
            >
              <ListChecks className="w-4 h-4" />
              <span>Список квестов ({doneCount}/{totalQuests})</span>
            </button>

            {showQuestList && (
              <div className="mt-2 bg-zinc-950/70 backdrop-blur-xl border border-orange-500/30 rounded-xl p-3 w-72 shadow-[0_0_25px_rgba(234,88,12,0.1)] pointer-events-none">
                <h4 className="text-xs font-bold text-orange-200 uppercase tracking-wide mb-2">Все задания</h4>
                <div className="space-y-2">
                  {quests.filter(q => q.id !== 5).map(q => {
                    const isActive = q.id === activeQuest?.id;
                    const isComplete = q.completed;
                    return (
                      <div key={q.id} className={cn(
                        "flex items-start gap-2 p-2 rounded-lg transition-all duration-300",
                        isActive && !isComplete ? "bg-orange-500/15 border border-orange-500/30 shadow-[0_0_10px_rgba(234,88,12,0.1)]" : "bg-zinc-800/40 border border-zinc-700/30",
                        isComplete ? "opacity-70" : ""
                      )}>
                        <div className={cn(
                          "w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold",
                          isComplete ? "bg-emerald-500 text-white" : isActive ? "bg-orange-500/30 text-orange-300 border border-orange-400" : "bg-zinc-700 text-zinc-500"
                        )}>
                          {isComplete ? <CheckCircle2 className="w-3 h-3" /> : q.id}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={cn("text-xs font-semibold", isComplete ? "text-emerald-400 line-through" : "text-zinc-200")}>
                            {q.title}
                          </p>
                          <p className={cn("text-[10px]", isComplete ? "text-zinc-600" : "text-zinc-400")}>{q.desc}</p>
                          {!isComplete && (
                            <div className="w-full bg-zinc-800 rounded-full h-1.5 mt-1 overflow-hidden">
                              <div className={cn(
                                "h-full rounded-full transition-all duration-500",
                                isActive ? "bg-orange-400" : "bg-zinc-600"
                              )} style={{ width: `${(q.current / q.target) * 100}%` }} />
                            </div>
                          )}
                        </div>
                        {isComplete && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Статус-бар поверх карты */}
        <div className="absolute top-3 left-3 flex items-center gap-2 z-20 pointer-events-none">
          <div className="bg-zinc-900/80 backdrop-blur border border-orange-500/30 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs">
            <Globe className="w-3 h-3 text-orange-400" />
            <span className="text-zinc-300">{BIOME_LABELS[worldBiome] ?? "🌿 Луговой"}</span>
          </div>
          <div className="bg-zinc-900/80 backdrop-blur border border-orange-500/30 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs">
            {TIME_ICONS[currentTime]}
            <span className="text-zinc-300">
              {{ day: "День", dusk: "Закат", night: "Ночь", dawn: "Рассвет" }[currentTime]}
            </span>
          </div>
        </div>

        {/* Подсказка управления */}
        <div className="absolute bottom-4 left-4 bg-zinc-900/80 backdrop-blur-md border border-orange-500/30 rounded-lg px-4 py-2 text-xs text-zinc-300 pointer-events-none z-20">
          <span className="text-orange-400 font-semibold">Управление: </span>
          <span className="opacity-70">WASD — движение · F — ломать · ЛКМ — добыть · Shift+ЛКМ — поставить · ↑↓ — история команд</span>
        </div>
      </div>

      {/* ── Правая панель (стекло) ─────────────────────────────── */}
      <div className="w-96 bg-zinc-900/60 backdrop-blur-xl border-l border-orange-500/20 flex flex-col z-30 shadow-[-4px_0_30px_rgba(0,0,0,0.4)]">

        {/* Заголовок */}
        <div className="p-3 border-b border-orange-500/20 flex items-center gap-2 bg-zinc-950/60 backdrop-blur-sm shrink-0">
          <Brain className="w-5 h-5 text-orange-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-base text-zinc-100">FluxCraft AI</h2>
            <p className="text-[10px] text-zinc-500">
              {gameMode === "quest" ? "Режим обучения" : "Llama 3.3 · задаёт уточняющие вопросы"}
            </p>
          </div>
          <Badge variant="outline" className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-[9px]">Groq FREE</Badge>
          <Button variant="ghost" size="icon" className="w-6 h-6 text-zinc-500 hover:text-zinc-300 shrink-0" onClick={clearChat} title="Очистить чат">
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>

        {/* Быстрые команды */}
        <div className="shrink-0 border-b border-orange-500/20 bg-zinc-950/60">
          <button
            className="w-full px-3 py-1.5 flex items-center justify-between text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={() => setShowQuick(v => !v)}
          >
            <span className="flex items-center gap-1"><Sparkles className="w-3 h-3 text-orange-400" />Быстрые команды</span>
            {showQuick ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showQuick && (
            <div className="px-2 pb-2 flex flex-wrap gap-1">
              {QUICK_COMMANDS.map((cmd, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(cmd.prompt)}
                  disabled={isGenerating}
                  className="px-2 py-0.5 text-[10px] rounded border border-orange-500/30 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 hover:text-orange-200 disabled:opacity-40 transition-colors"
                >
                  {cmd.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Чат */}
        <div className="flex-1 p-3 overflow-y-auto space-y-2.5 min-h-0">
          {messages.map((msg, i) => (
            <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              <Card className={cn("max-w-[90%] p-2.5 text-sm",
                msg.role === "user"      ? "bg-orange-600 text-white border-orange-500"
                : msg.mode === "map"     ? "bg-zinc-800 text-zinc-100 border-blue-500/40"
                : msg.mode === "area"    ? "bg-zinc-800 text-zinc-100 border-yellow-500/40"
                : msg.mode === "objects" ? "bg-zinc-800 text-zinc-100 border-green-500/40"
                : msg.mode === "clarify" ? "bg-zinc-800 text-zinc-100 border-orange-400/60 shadow-orange-900/20 shadow-md"
                : msg.mode === "build"   ? "bg-zinc-800 text-zinc-100 border-amber-500/40"
                : msg.mode === "terrain" ? "bg-zinc-800 text-zinc-100 border-teal-500/40"
                : msg.mode === "error"   ? "bg-zinc-800 text-zinc-100 border-red-500/40"
                : "bg-zinc-800 text-zinc-100 border-zinc-700"
              )}>
                {msg.role === "assistant" && msg.mode && !["patch","error"].includes(msg.mode) && (
                  <div className={cn("flex items-center gap-1 mb-1 text-[9px] font-semibold uppercase tracking-wide",
                    msg.mode === "map"     ? "text-blue-400"
                    : msg.mode === "area"  ? "text-yellow-400"
                    : msg.mode === "objects" ? "text-green-400"
                    : msg.mode === "clarify" ? "text-orange-300"
                    : msg.mode === "time"  ? "text-amber-300"
                    : msg.mode === "build" ? "text-orange-300"
                    : msg.mode === "terrain" ? "text-teal-300"
                    : "text-zinc-400")}>
                    {msg.mode === "map"     ? <><Map className="w-2.5 h-2.5"/>Полная карта · Llama 3.3</>
                    : msg.mode === "area"   ? <><Zap className="w-2.5 h-2.5"/>Изменение зоны</>
                    : msg.mode === "objects"? <><Package className="w-2.5 h-2.5"/>Объекты</>
                    : msg.mode === "clarify"? <>🤔 Уточняющий вопрос</>
                    : msg.mode === "time"   ? <><Clock className="w-2.5 h-2.5"/>Смена времени</>
                    : msg.mode === "build"  ? <><Hammer className="w-2.5 h-2.5"/>Строительство</>
                    : msg.mode === "terrain"? <>⛰️ Ландшафт</>
                    : null}
                  </div>
                )}
                {msg.content.startsWith("__CLARIFY_BUTTONS__:") ? (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {msg.content.replace("__CLARIFY_BUTTONS__:","").split("|").map((opt: string, oi: number) => (
                      <button key={oi} onClick={() => handleSend(opt)}
                        className="px-2 py-1 text-[11px] rounded border border-orange-500/50 bg-orange-500/15 text-orange-300 hover:bg-orange-500/30 transition-colors">
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed text-[13px]">{msg.content}</p>
                )}
              </Card>
            </div>
          ))}
          {isGenerating && (
            <div className="flex justify-start">
              <Card className="bg-zinc-800 p-2.5 flex items-center gap-2 border-orange-500/30">
                <Loader2 className="animate-spin w-3.5 h-3.5 text-orange-400 shrink-0" />
                <div>
                  <p className="text-zinc-100 text-xs">Llama 3.3 думает...</p>
                  <p className="text-zinc-500 text-[10px]">via Groq (бесплатно)</p>
                </div>
              </Card>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Поле ввода */}
        <div className="p-3 border-t border-orange-500/20 bg-zinc-950/80 shrink-0">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => window.dispatchEvent(new CustomEvent("phaser-input-focus", { detail: { enabled: false } }))}
              onBlur={() => window.dispatchEvent(new CustomEvent("phaser-input-focus", { detail: { enabled: true } }))}
              placeholder="Снежный лес, построй замок..."
              disabled={isGenerating}
              className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-orange-500 text-sm"
            />
            <Button onClick={() => handleSend()} disabled={isGenerating || !input.trim()} size="icon" className="bg-orange-600 hover:bg-orange-500 shrink-0">
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-zinc-600 mt-1 text-center">↑↓ история · Enter отправить · AI задаёт вопросы</p>
        </div>

        {/* Инвентарь / Статистика */}
        <div className="border-t border-orange-500/20 bg-zinc-900/80 shrink-0 flex flex-col max-h-[260px]">
          {/* Табы */}
          <div className="flex border-b border-zinc-800 shrink-0">
            <button
              onClick={() => setTab("inventory")}
              className={cn("flex-1 py-1.5 text-[11px] font-medium transition-colors",
                tab === "inventory" ? "text-orange-400 border-b-2 border-orange-400" : "text-zinc-500 hover:text-zinc-300")}
            >
              Инвентарь {totalItems > 0 && <span className="ml-1 text-orange-300">({totalItems})</span>}
            </button>
            <button
              onClick={() => setTab("stats")}
              className={cn("flex-1 py-1.5 text-[11px] font-medium transition-colors",
                tab === "stats" ? "text-orange-400 border-b-2 border-orange-400" : "text-zinc-500 hover:text-zinc-300")}
            >
              Мир
            </button>
          </div>

          {tab === "inventory" ? (
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {Object.entries(inventory).filter(([,c]) => c > 0).length === 0 ? (
                <div className="text-[11px] text-zinc-500 p-2 bg-zinc-800 rounded border border-zinc-700">
                  Ломай объекты (F или ЛКМ) · Shift+ЛКМ — поставить
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(inventory)
                    .filter(([,c]) => c > 0)
                    .sort((a, b) => b[1] - a[1])
                    .map(([id, count]) => (
                      <Button key={id} variant={selected === id ? "default" : "outline"} size="sm"
                        onClick={() => handleSelect(id)}
                        className={cn("justify-start px-1.5 h-8 text-[10px]",
                          selected === id ? "bg-orange-600 hover:bg-orange-500 text-white border-orange-400"
                          : "border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400")}>
                        <div className={cn("w-2.5 h-2.5 rounded-sm mr-1.5 shrink-0", getItemColor(id))} />
                        <span className="truncate flex-1 text-left">{getItemName(id)}</span>
                        <span className="ml-1 opacity-70 font-mono shrink-0">×{count}</span>
                      </Button>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2 text-[11px] text-zinc-400">
              <div className="grid grid-cols-2 gap-1.5">
                <div className="bg-zinc-800 rounded p-2 border border-zinc-700">
                  <div className="text-zinc-500 text-[10px]">Биом</div>
                  <div className="text-zinc-200 font-medium">{BIOME_LABELS[worldBiome] ?? "🌿 Луговой"}</div>
                </div>
                <div className="bg-zinc-800 rounded p-2 border border-zinc-700">
                  <div className="text-zinc-500 text-[10px]">Время</div>
                  <div className="text-zinc-200 font-medium flex items-center gap-1">
                    {TIME_ICONS[currentTime]}
                    {{ day:"День", dusk:"Закат", night:"Ночь", dawn:"Рассвет" }[currentTime]}
                  </div>
                </div>
                <div className="bg-zinc-800 rounded p-2 border border-zinc-700">
                  <div className="text-zinc-500 text-[10px]">Предметов</div>
                  <div className="text-zinc-200 font-medium">{totalItems}</div>
                </div>
                <div className="bg-zinc-800 rounded p-2 border border-zinc-700">
                  <div className="text-zinc-500 text-[10px]">Видов</div>
                  <div className="text-zinc-200 font-medium">{Object.values(inventory).filter(c => c > 0).length}</div>
                </div>
              </div>
              {/* Индикатор прогресса квестов в stats */}
              {gameMode === "quest" && (
                <div className="bg-zinc-800 rounded p-2 border border-orange-500/30">
                  <div className="text-zinc-500 text-[10px] mb-1">Квесты ({doneCount}/{totalQuests})</div>
                  <div className="w-full bg-zinc-900 rounded-full h-2 overflow-hidden">
                    <div className="bg-gradient-to-r from-orange-500 to-emerald-400 h-full transition-all duration-700 rounded-full"
                      style={{ width: `${(doneCount / totalQuests) * 100}%` }} />
                  </div>
                </div>
              )}
              {/* Быстрая смена времени */}
              <div className="text-[10px] text-zinc-500 mt-1">Смена времени:</div>
              <div className="flex gap-1">
                {(["day","dusk","night","dawn"] as TimeOfDay[]).map(t => (
                  <button key={t} onClick={() => applyTime(t)}
                    className={cn("flex-1 py-1 rounded text-[9px] border transition-colors",
                      currentTime === t ? "border-orange-400 bg-orange-500/20 text-orange-300"
                      : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300")}>
                    {TIME_ICONS[t]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Кнопки сохранения и генерации */}
          <div className="flex gap-2 p-2 border-t border-zinc-800 shrink-0">
            <Button variant="outline" size="sm" className="flex-1 border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400 text-[11px] h-7"
              onClick={() => window.dispatchEvent(new CustomEvent("phaser-save-world"))}>
              <Save className="mr-1 w-3 h-3" /> Сохранить
            </Button>
            <Button variant="outline" size="sm" className="flex-1 border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400 text-[11px] h-7"
              onClick={() => window.dispatchEvent(new CustomEvent("ai-patch-map", { detail: { prompt: "регенерация" } }))}>
              <RefreshCw className="mr-1 w-3 h-3" /> Новый мир
            </Button>
            <Button variant="outline" size="sm" className="border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400 h-7" asChild>
              <Link href="/gallery"><ImageIcon className="w-3 h-3" /></Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}