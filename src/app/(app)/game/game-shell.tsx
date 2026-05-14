"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Send, Save, Loader2, Brain, Zap, Map, Package, Mountain, PaintBucket, LayoutGrid, Spline, SunMoon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import PhaserCanvas from "./phaser-canvas";
import { type TileId } from "./phaser-game";

type Message = {
  role: "user" | "assistant";
  content: string;
  mode?: "map" | "area" | "objects" | "patch" | "time" | "build" | "chat" | "error" | "terrain" | "region" | "fill" | "pattern" | "blend";
};

type Inventory = Record<string, number>;

const ITEM_NAMES: Record<string, string> = {
  grass: "Трава", rock: "Камень", tree: "Дерево", ruins: "Руины",
  grass_snow: "Снежная трава", rock_snow: "Снежный камень",
  tree_snow: "Снежная ель", ruins_snow: "Снежные руины",
  grass_magma: "Магм. порода", rock_magma: "Вулк. камень",
  tree_magma: "Уголь", ruins_magma: "Обугл. руины",
  grass_sand: "Песок", rock_sand: "Песч. камень",
  tree_sand: "Кактус", ruins_sand: "Руины пустыни",
  crystal: "💎 Кристалл", mushroom: "🍄 Гриб",
  ice: "🧊 Лёд", mythic_grass: "✨ Миф. трава",
  mythic_rock: "💜 Миф. камень", snowball: "⚪ Снежком",
  frozen_lake: "❄️ Заморозь", quartz: "🔮 Кварц",
  board: "🪵 Доска", glass: "🪟 Стекло",
  concrete: "🧱 Бетон", plant: "🌿 Растение",
  glowing_mushroom: "💡 Светогриб", ash: "💨 Пепел",
  coral: "🪸 Коралл",
};

function getItemColor(id: string): string {
  if (id.includes("snow"))           return "bg-blue-100 border border-blue-200";
  if (id.includes("magma"))          return "bg-red-950 border border-red-800";
  if (id.includes("sand"))           return "bg-yellow-200 border border-yellow-300";
  if (id === "crystal")              return "bg-blue-900 border border-blue-400";
  if (id === "mushroom")             return "bg-red-900 border border-red-600";
  if (id === "glowing_mushroom")     return "bg-cyan-900 border border-cyan-400";
  if (id === "mythic_grass")         return "bg-purple-800 border border-purple-400";
  if (id === "mythic_rock")          return "bg-purple-950 border border-purple-500";
  if (id === "ice" || id === "frozen_lake") return "bg-sky-200 border border-sky-300";
  if (id === "quartz")               return "bg-pink-100 border border-pink-300";
  if (id === "glass")                return "bg-sky-100 border border-sky-200";
  if (id === "concrete")             return "bg-gray-400 border border-gray-500";
  if (id === "board")                return "bg-amber-700 border border-amber-600";
  if (id === "plant")                return "bg-green-600 border border-green-500";
  if (id === "snowball")             return "bg-white border border-blue-100";
  if (id === "ash")                  return "bg-gray-700 border border-gray-600";
  if (id === "coral")                return "bg-orange-500 border border-orange-400";
  if (id === "tree")                 return "bg-green-700";
  if (id === "rock")                 return "bg-zinc-500";
  if (id === "ruins")                return "bg-zinc-600";
  return "bg-green-600";
}

const BIOME_LABELS: Record<string, string> = {
  snow: "❄️ Снежный", lava: "🌋 Лавовый",
  desert: "🏜️ Пустынный", forest: "🌲 Лесной",
  city: "🏙️ Городской", default: "🌿 Луговой",
  mythic: "✨ Мифический", swamp: "🌿 Болото",
};

const MODE_ICONS: Record<string, React.ReactNode> = {
  map: <Map className="w-3 h-3 inline mr-1" />,
  area: <Zap className="w-3 h-3 inline mr-1" />,
  objects: <Package className="w-3 h-3 inline mr-1" />,
  time: <SunMoon className="w-3 h-3 inline mr-1" />,
  build: <span className="mr-1">🏗️</span>,
  terrain: <Mountain className="w-3 h-3 inline mr-1" />,
  region: <LayoutGrid className="w-3 h-3 inline mr-1" />,
  fill: <PaintBucket className="w-3 h-3 inline mr-1" />,
  pattern: <Spline className="w-3 h-3 inline mr-1" />,
  blend: <span className="mr-1">🎨</span>,
};

// Подсказки для быстрых действий
const SUGGESTIONS = [
  { text: "❄️ Снежный лес", icon: "🏔️" },
  { text: "🌋 Лавовый мир", icon: "🔥" },
  { text: "🏜️ Пустыня с оазисом", icon: "🌵" },
  { text: "✨ Мифический лес", icon: "💜" },
  { text: "🏗️ Замок 5x3 из стекла", icon: "🏰" },
  { text: "🌙 Сделай ночь", icon: "🌙" },
  { text: "🏞️ Создай гору", icon: "⛰️" },
  { text: "🌊 Сделай реку", icon: "🌊" },
  { text: "🛣️ Проложи дорогу", icon: "🛤️" },
  { text: "🌿 Болото с грибами", icon: "🍄" },
];

export function GameShell() {
  const [inventory, setInventory] = useState<Inventory>({});
  const [selected, setSelected] = useState<string>("grass");
  const selectedRef = useRef<string>("grass");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback((id: string) => {
    selectedRef.current = id;
    setSelected(id);
  }, []);

  const [messages, setMessages] = useState<Message[]>([{
    role: "assistant",
    content: "🌟 **Добро пожаловать в FluxCraft!**\n\nЯ — ИИ-движок игры. Говори мне, что ты хочешь построить, и я сделаю это.\n\n**🎮 Что можно делать:**\n• **🌍 Миры:** «снежный лес», «вулканический мир», «мифический лес с кристаллами»\n• **🏗️ Строить:** «построй замок 5×3 из стекла», «башню 3×5 изо льда»\n• **🏞️ Рельеф:** «создай гору», «сделай реку», «проложи дорогу»\n• **✏️ Изменения:** «замени камни на деревья», «убери воду»\n• **🎨 Узоры:** «сделай шахматную доску», «полосатый узор»\n• **🌙 Время:** «сделай ночь», «закат», «рассвет»\n• **📦 Объекты:** «поставь рядом кристаллы», «добавь светящиеся грибы»\n\n_Ниже — примеры запросов. Просто нажми!_ 👇",
  }]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating]);

  const getSelectedTile = useCallback((): TileId => {
    const base = selectedRef.current.split("_")[0] as TileId;
    const valid: TileId[] = ["grass", "water", "rock", "tree", "ruins", "empty"];
    return valid.includes(base) ? base : "grass";
  }, []);

  const getSelectedItem = useCallback((): string => selectedRef.current, []);
  const handleInventory = useCallback((inv: Inventory) => setInventory(inv), []);

  // Показать всплывающее уведомление на Phaser canvas через custom event
  const showPhaserNotification = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent("phaser-notification", { detail: { text } }));
  }, []);

  const handleSend = useCallback(async (overrideText?: string) => {
    const userText = (overrideText ?? input).trim();
    if (!userText || isGenerating) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userText }]);

    setIsGenerating(true);
    try {
      const seed = Math.floor(Math.random() * 1000000);
      const aiPrompt = `${userText} [Seed: ${seed}]`;

      const res = await fetch("/api/game-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();

      // Обработка всех типов команд
      if (data.command === "generate_map") {
        if (data.map && Array.isArray(data.map)) {
          window.dispatchEvent(new CustomEvent("ai-map-generated", {
            detail: { biome: data.biome || "default", map: data.map }
          }));
          setMessages((prev) => [...prev, {
            role: "assistant",
            content: `🗺️ **Карта сгенерирована:** ${BIOME_LABELS[data.biome] ?? data.biome ?? "смешанный"} биом`,
            mode: "map",
          }]);
        } else if (data.biome) {
          window.dispatchEvent(new CustomEvent("ai-patch-map", {
            detail: { biome: data.biome }
          }));
          setMessages((prev) => [...prev, {
            role: "assistant",
            content: `🌍 **Биом изменён:** ${BIOME_LABELS[data.biome] ?? data.biome}`,
            mode: "map",
          }]);
        }
      } else if (data.command === "modify_area" && data.changes) {
        window.dispatchEvent(new CustomEvent("ai-modify-area", {
          detail: { changes: data.changes }
        }));
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `⚡ **Зона изменена:** ${data.changes.length} тайлов`,
          mode: "area",
        }]);
      } else if (data.command === "place_objects" && data.objects) {
        window.dispatchEvent(new CustomEvent("ai-place-objects", {
          detail: { objects: data.objects }
        }));
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `📦 **Объекты размещены рядом с вами**`,
          mode: "objects",
        }]);
      } else if (data.command === "set_time") {
        window.dispatchEvent(new CustomEvent("ai-set-time", {
          detail: { time: data.value }
        }));
        const labels: Record<string, string> = {
          day: "☀️ День наступил!",
          dusk: "🌅 Закат...",
          night: "🌙 Ночь наступила!",
          dawn: "🌄 Рассвет!"
        };
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: labels[data.value] || `Время: ${data.value}`,
          mode: "time",
        }]);
      } else if (data.command === "build") {
        const playerPos = (window as any).__playerPosition as { x: number; y: number } | undefined;
        const px = playerPos?.x ?? 32;
        const py = playerPos?.y ?? 32;
        const startX = Math.max(0, px - Math.floor((data.width || 3) / 2));
        const startY = Math.max(0, py - (data.height || 3) - 1);
        window.dispatchEvent(new CustomEvent("ai-build-structure", {
          detail: { structure: data.structure || userText, x: startX, y: startY, width: data.width || 3, height: data.height || 3, tile: data.tile }
        }));
        const structureName = data.structure || "постройка";
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `🏗️ **${structureName}** ${data.width||3}×${data.height||3} из **${data.tile || 'камня'}** построена!`,
          mode: "build",
        }]);
      } else if (data.command === "terrain") {
        // Продвинутое терраформирование
        window.dispatchEvent(new CustomEvent("ai-terrain", {
          detail: data
        }));
        const shapeNames: Record<string, string> = {
          mountain: "⛰️ Гору", valley: "🏞️ Долину", river: "🌊 Реку",
          lake: "🏖️ Озеро", hill: "⛰️ Холм", canyon: "🏜️ Каньон",
          plateau: "🗻 Плато", peninsula: "🦴 Полуостров",
          bridge: "🌉 Мост", road: "🛣️ Дорогу"
        };
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `${shapeNames[data.shape] ?? '🏔️ Ландшафт'} создан! Радиус: ${data.radius || 10} тайлов`,
          mode: "terrain",
        }]);
      } else if (data.command === "modify_region") {
        window.dispatchEvent(new CustomEvent("ai-modify-region", {
          detail: data
        }));
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `📐 **Регион изменён:** (${data.x1},${data.y1}) — (${data.x2},${data.y2})`,
          mode: "region",
        }]);
      } else if (data.command === "fill_area") {
        window.dispatchEvent(new CustomEvent("ai-fill-area", {
          detail: data
        }));
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `🪣 **Область заполнена:** тайл ${data.tile || 'G'}`,
          mode: "fill",
        }]);
      } else if (data.command === "pattern") {
        window.dispatchEvent(new CustomEvent("ai-pattern", {
          detail: data
        }));
        const patternNames: Record<string, string> = {
          checkerboard: "шахматная доска",
          stripes: "полосы",
          rings: "кольца",
          spiral: "спираль",
          gradient: "градиент"
        };
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `🎨 **Узор «${patternNames[data.type] ?? data.type}»** нанесён!`,
          mode: "pattern",
        }]);
      } else if (data.command === "custom_tileset" && data.tiles) {
        window.dispatchEvent(new CustomEvent("ai-custom-tileset", {
          detail: data
        }));
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `🎯 **Размещено ${data.tiles.length} объектов** в разных местах`,
          mode: "area",
        }]);
      } else if (data.command === "biome_blend") {
        window.dispatchEvent(new CustomEvent("ai-biome-blend", {
          detail: data
        }));
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `🎨 **Смешивание биомов:** ${data.primary} → ${data.secondary}`,
          mode: "blend",
        }]);
      } else if (data.command === "chat" && data.message) {
        setMessages((prev) => [...prev, { 
          role: "assistant", 
          content: `💬 ${data.message}`,
          mode: "chat",
        }]);
      } else if (data.command === "fallback") {
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `🤔 ${data.message || 'Не понял запрос. Попробуй: "снежный лес", "построй замок 5 на 3", "сделай ночь"'}`,
          mode: "error",
        }]);
      } else {
        // Fallback по умолчанию
        window.dispatchEvent(new CustomEvent("ai-patch-map", {
          detail: { prompt: userText }
        }));
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `🔄 Обрабатываю запрос...`,
          mode: "area",
        }]);
      }
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `⚠️ **Ошибка:** ${err instanceof Error ? err.message : "Неизвестная"}. Попробуй ещё раз.`,
        mode: "error",
      }]);
    } finally {
      setIsGenerating(false);
      window.focus();
      window.dispatchEvent(new CustomEvent("phaser-input-focus", { detail: { enabled: true } }));
      window.dispatchEvent(new CustomEvent("phaser-keyboard-reset"));
    }
  }, [input, isGenerating]);

  const handleSuggestion = useCallback((suggestion: string) => {
    handleSend(suggestion);
  }, [handleSend]);

  return (
    <div className="flex h-screen bg-zinc-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-orange-950/30 to-zinc-950 overflow-hidden">
      {/* Canvas */}
      <div className="flex-1 relative">
        <PhaserCanvas getSelectedTile={getSelectedTile} getSelectedItem={getSelectedItem} onInventory={handleInventory} />
        <div className="absolute bottom-4 left-4 bg-zinc-900/80 backdrop-blur-md border border-orange-500/30 rounded-lg px-4 py-3 text-xs text-zinc-300 shadow-lg pointer-events-none z-20">
          <span className="text-orange-400 font-semibold">🎮 Управление: </span>
          <span className="opacity-70">WASD — движение · F — ломать · ЛКМ — добыть · Shift+ЛКМ — поставить</span>
        </div>
      </div>

      {/* Панель */}
      <div className="w-96 bg-zinc-900/80 border-l border-orange-500/20 backdrop-blur-md flex flex-col z-30">
        {/* Заголовок */}
        <div className="p-4 border-b border-orange-500/20 flex items-center gap-3 bg-zinc-950/80 shrink-0">
          <Brain className="w-6 h-6 text-orange-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-lg text-zinc-100">FluxCraft AI</h2>
            <p className="text-xs text-zinc-500">Llama 3.3 · Все команды</p>
          </div>
          <Badge variant="outline" className="bg-orange-500/20 text-orange-400 border-orange-500/30 shrink-0 text-[10px]">
            Groq FREE
          </Badge>
        </div>

        {/* Чат */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3 min-h-0">
          {messages.map((msg, i) => (
            <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              <Card className={cn("max-w-[92%] p-3 text-sm",
                msg.role === "user"
                  ? "bg-orange-600 text-white border-orange-500"
                  : msg.mode === "map"
                  ? "bg-zinc-800 text-zinc-100 border-blue-500/40 shadow-md"
                  : msg.mode === "area"
                  ? "bg-zinc-800 text-zinc-100 border-yellow-500/40 shadow-md"
                  : msg.mode === "objects"
                  ? "bg-zinc-800 text-zinc-100 border-green-500/40 shadow-md"
                  : msg.mode === "terrain"
                  ? "bg-zinc-800 text-zinc-100 border-cyan-500/40 shadow-md"
                  : msg.mode === "region"
                  ? "bg-zinc-800 text-zinc-100 border-indigo-500/40 shadow-md"
                  : msg.mode === "fill"
                  ? "bg-zinc-800 text-zinc-100 border-teal-500/40 shadow-md"
                  : msg.mode === "pattern"
                  ? "bg-zinc-800 text-zinc-100 border-purple-500/40 shadow-md"
                  : msg.mode === "blend"
                  ? "bg-zinc-800 text-zinc-100 border-pink-500/40 shadow-md"
                  : msg.mode === "error"
                  ? "bg-zinc-800 text-zinc-100 border-red-500/40"
                  : "bg-zinc-800 text-zinc-100 border-zinc-700"
              )}>
                {msg.role === "assistant" && msg.mode && msg.mode !== "patch" && msg.mode !== "error" && msg.mode !== "chat" && (
                  <div className={cn("flex items-center gap-1 mb-1.5 text-[10px] font-semibold uppercase tracking-wide",
                    msg.mode === "map" ? "text-blue-400" 
                    : msg.mode === "area" ? "text-yellow-400" 
                    : msg.mode === "time" ? "text-amber-300"
                    : msg.mode === "build" ? "text-orange-300"
                    : msg.mode === "terrain" ? "text-cyan-400"
                    : msg.mode === "pattern" ? "text-purple-400"
                    : msg.mode === "blend" ? "text-pink-400"
                    : "text-green-400")}>
                    {MODE_ICONS[msg.mode]}
                    {msg.mode === "map" ? "Полная карта · Llama" 
                    : msg.mode === "area" ? "Изменение зоны" 
                    : msg.mode === "time" ? "Смена времени суток"
                    : msg.mode === "build" ? "Строительство"
                    : msg.mode === "terrain" ? "Ландшафт"
                    : msg.mode === "region" ? "Регион"
                    : msg.mode === "fill" ? "Заливка"
                    : msg.mode === "pattern" ? "Узор"
                    : msg.mode === "blend" ? "Смешивание"
                    : "Объекты"}
                  </div>
                )}
                <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
              </Card>
            </div>
          ))}
          {isGenerating && (
            <div className="flex justify-start">
              <Card className="bg-zinc-800 p-3 flex items-center gap-2 border-orange-500/30">
                <Loader2 className="animate-spin w-4 h-4 text-orange-400 shrink-0" />
                <div>
                  <p className="text-zinc-100 text-sm">Llama 3.3 генерирует...</p>
                  <p className="text-zinc-500 text-xs">via Groq (бесплатно)</p>
                </div>
              </Card>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Ввод */}
        <div className="p-4 border-t border-orange-500/20 bg-zinc-950/80 shrink-0">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSend(); }}
              onFocus={() => window.dispatchEvent(new CustomEvent("phaser-input-focus", { detail: { enabled: false } }))}
              onBlur={() => window.dispatchEvent(new CustomEvent("phaser-input-focus", { detail: { enabled: true } }))}
              placeholder="Опиши, что хочешь создать..."
              disabled={isGenerating}
              className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-orange-500"
            />
            <Button onClick={() => handleSend()} disabled={isGenerating || !input.trim()} size="icon" className="bg-orange-600 hover:bg-orange-500 shrink-0">
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>

          {/* Быстрые подсказки */}
          <div className="flex gap-1.5 mt-2 flex-wrap justify-center">
            {SUGGESTIONS.slice(0, 5).map((s) => (
              <button
                key={s.text}
                onClick={() => handleSuggestion(s.text)}
                disabled={isGenerating}
                className="text-[10px] bg-zinc-800/60 hover:bg-orange-500/20 text-zinc-400 hover:text-orange-300 px-2 py-1 rounded-full border border-zinc-700/50 hover:border-orange-500/40 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {s.icon} {s.text}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 mt-1 flex-wrap justify-center">
            {SUGGESTIONS.slice(5).map((s) => (
              <button
                key={s.text}
                onClick={() => handleSuggestion(s.text)}
                disabled={isGenerating}
                className="text-[10px] bg-zinc-800/60 hover:bg-orange-500/20 text-zinc-400 hover:text-orange-300 px-2 py-1 rounded-full border border-zinc-700/50 hover:border-orange-500/40 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {s.icon} {s.text}
              </button>
            ))}
          </div>
        </div>

        {/* Инвентарь */}
        <div className="p-4 border-t border-orange-500/20 bg-zinc-900/80 space-y-3 overflow-y-auto max-h-[240px] shrink-0">
          <div className="text-sm font-medium text-zinc-100">🎒 Инвентарь</div>
          {Object.entries(inventory).filter(([, c]) => c > 0).length === 0 ? (
            <div className="text-xs text-zinc-500 p-3 bg-zinc-800 rounded border border-zinc-700">Ломай объекты (F или ЛКМ)</div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(inventory).map(([id, count]) => count > 0 && (
                <Button key={id} variant={selected === id ? "default" : "outline"} size="sm"
                  onClick={() => handleSelect(id)}
                  className={cn("justify-start px-2 h-9 text-[10px]",
                    selected === id ? "bg-orange-600 hover:bg-orange-500 text-white border-orange-400"
                    : "border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400")}>
                  <div className={cn("w-3 h-3 rounded-sm mr-2 shrink-0", getItemColor(id))} />
                  <span className="truncate flex-1 text-left">{ITEM_NAMES[id] ?? id}</span>
                  <span className="ml-1 opacity-70 font-mono shrink-0">×{count}</span>
                </Button>
              ))}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1 border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400"
              onClick={() => window.dispatchEvent(new CustomEvent("phaser-save-world"))}>
              <Save className="mr-2 w-4 h-4" /> 💾 Сохранить
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}