"use client";
 
import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { Send, Sparkles, Save, ImageIcon, Loader2, Brain } from "lucide-react";
 
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
  isAi?: boolean; // сгенерировано Claude
};
 
type Inventory = Record<string, number>;
 
const ITEM_NAMES: Record<string, string> = {
  grass: "Трава",
  rock: "Камень",
  tree: "Дерево",
  ruins: "Руины",
  grass_snow: "Снежная трава",
  rock_snow: "Снежный камень",
  tree_snow: "Снежное дерево",
  ruins_snow: "Снежные руины",
  grass_magma: "Магм. порода",
  rock_magma: "Магм. камень",
  tree_magma: "Уголь",
  ruins_magma: "Обугл. руины",
  grass_sand: "Песок",
  rock_sand: "Песч. камень",
  tree_sand: "Кактус",
  ruins_sand: "Руины пустыни",
};
 
function getItemColor(id: string): string {
  if (id.includes("snow")) return "bg-blue-100 border border-blue-200";
  if (id.includes("magma")) return "bg-red-950 border border-red-800";
  if (id.includes("sand")) return "bg-yellow-200 border border-yellow-300";
  if (id === "tree") return "bg-green-700";
  if (id === "rock") return "bg-zinc-500";
  if (id === "ruins") return "bg-zinc-600";
  return "bg-green-600";
}
 
export function GameShell() {
  const [inventory, setInventory] = useState<Inventory>({});
  const [selected, setSelected] = useState<string>("grass");
  const selectedRef = useRef<string>("grass");
  const chatEndRef = useRef<HTMLDivElement>(null);
 
  const handleSelect = useCallback((id: string) => {
    selectedRef.current = id;
    setSelected(id);
  }, []);
 
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Привет! Я ИИ-помощник на базе Claude. Опиши биом — и я сгенерирую карту мира специально для тебя.\n\nПримеры:\n• «Снежный лес с замёрзшим озером»\n• «Вулканический остров с руинами»\n• «Пустыня с оазисом и древними храмами»",
    },
  ]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
 
  // Автоскролл чата вниз
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating]);
 
  const handleSend = useCallback(async () => {
    if (!input.trim() || isGenerating) return;

    const userText = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userText }]);

    const lower = userText.toLowerCase();

    // Локальные команды — патч карты без AI (быстро, без запроса)
    const isPatchCommand = [
      "замени", "поменяй", "убери", "удали", "вместо", "очисти",
      "расставь", "рассыпь", "разбрось",
    ].some((w) => lower.includes(w));

    if (isPatchCommand) {
      window.dispatchEvent(new CustomEvent("ai-patch-map", { detail: { prompt: lower } }));
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `✏️ Применяю изменения: "${userText}"`,
          isAi: false,
        },
      ]);
      return;
    }

    // Команды размещения объектов рядом с игроком
    const isPlaceCommand = [
      "добавь", "поставь", "построй", "посади", "положи", "установи",
    ].some((w) => lower.includes(w));

    // Всё остальное — генерация карты через Groq AI
    setIsGenerating(true);

    try {
      // Получаем позицию игрока из Phaser (если доступна)
      const playerPos = (window as any).__playerPosition as { x: number; y: number } | undefined;

      const res = await fetch("/api/game-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userText,
          playerX: playerPos?.x ?? 32,
          playerY: playerPos?.y ?? 32,
          isPlaceCommand,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();

      if (data.command === "generate_map" && Array.isArray(data.map)) {
        window.dispatchEvent(
          new CustomEvent("ai-map-generated", {
            detail: { biome: data.biome, map: data.map },
          })
        );
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `🗺️ ${data.description}\n\nБиом: **${data.biome}** · 64×64 тайлов`,
            isAi: true,
          },
        ]);
      } else if (data.command === "modify_area" && Array.isArray(data.changes)) {
        window.dispatchEvent(
          new CustomEvent("ai-modify-area", { detail: { changes: data.changes } })
        );
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `🔨 ${data.description}`,
            isAi: true,
          },
        ]);
      } else if (data.command === "place_objects" && Array.isArray(data.objects)) {
        window.dispatchEvent(
          new CustomEvent("ai-place-objects", { detail: { objects: data.objects } })
        );
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `📦 ${data.description}`,
            isAi: true,
          },
        ]);
      } else {
        // Фолбэк — если AI вернул что-то непонятное
        window.dispatchEvent(new CustomEvent("ai-patch-map", { detail: { prompt: lower } }));
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `✏️ ${data.description ?? "Команда выполнена"}`, isAi: true },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ Ошибка: ${err instanceof Error ? err.message : "Неизвестная ошибка"}. Попробуй ещё раз.`,
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  }, [input, isGenerating]);
 
  const getSelectedTile = useCallback((): TileId => {
    const baseTile = selectedRef.current.split("_")[0] as TileId;
    const validTiles: TileId[] = [
      "grass", "water", "rock", "tree", "ruins", "empty",
    ];
    return validTiles.includes(baseTile) ? baseTile : "grass";
  }, []);
 
  const getSelectedItem = useCallback((): string => selectedRef.current, []);
 
  const handleInventory = useCallback((inv: Inventory) => {
    setInventory(inv);
  }, []);
 
  return (
    <div className="flex h-screen bg-zinc-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-orange-950/30 to-zinc-950 overflow-hidden">
      {/* Phaser canvas */}
      <div className="flex-1 relative">
        <PhaserCanvas
          getSelectedTile={getSelectedTile}
          getSelectedItem={getSelectedItem}
          onInventory={handleInventory}
        />
 
        {/* Подсказка управления */}
        <div className="absolute bottom-4 left-4 bg-zinc-900/80 backdrop-blur-md border border-orange-500/30 rounded-lg px-4 py-3 text-xs text-zinc-300 shadow-lg pointer-events-none z-20">
          <span className="text-orange-400 font-semibold">Управление: </span>
          <span className="opacity-70">
            WASD — движение · F — ломать · ЛКМ — добыть · Shift+ЛКМ — поставить
          </span>
        </div>
      </div>
 
      {/* Правая панель */}
      <div className="w-96 bg-zinc-900/80 border-l border-orange-500/20 backdrop-blur-md flex flex-col z-30">
        {/* Заголовок */}
        <div className="p-4 border-b border-orange-500/20 flex items-center gap-3 bg-zinc-950/80">
          <Brain className="w-6 h-6 text-orange-400" />
          <div className="flex-1">
            <h2 className="font-bold text-lg text-zinc-100">AI Biomecraft 2D</h2>
            <p className="text-xs text-zinc-500">
              Карта генерируется Gemini AI по описанию
            </p>
          </div>
          <Badge
            variant="outline"
            className="bg-orange-500/20 text-orange-400 border-orange-500/30"
          >
            Gemini
          </Badge>
        </div>
 
        {/* Чат */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4 min-h-0">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              <Card
                className={cn(
                  "max-w-[85%] p-3 text-sm",
                  msg.role === "user"
                    ? "bg-orange-600 text-white border-orange-500"
                    : msg.isAi
                    ? "bg-zinc-800 text-zinc-100 border-orange-500/40 shadow-orange-900/20 shadow-md"
                    : "bg-zinc-800 text-zinc-100 border-zinc-700"
                )}
              >
                {msg.isAi && (
                  <div className="flex items-center gap-1 mb-1 text-orange-400 text-[10px] font-semibold uppercase tracking-wide">
                    <Brain className="w-3 h-3" /> Gemini AI
                  </div>
                )}
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </Card>
            </div>
          ))}
          {isGenerating && (
            <div className="flex justify-start">
              <Card className="bg-zinc-800 p-3 flex items-center gap-2 border-orange-500/30">
                <Loader2 className="animate-spin w-4 h-4 text-orange-400" />
                <div>
                  <p className="text-zinc-100 text-sm">Gemini генерирует карту...</p>
                  <p className="text-zinc-500 text-xs">64×64 тайлов</p>
                </div>
              </Card>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
 
        {/* Поле ввода */}
        <div className="p-4 border-t border-orange-500/20 bg-zinc-950/80">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) handleSend();
              }}
              onFocus={() =>
                window.dispatchEvent(
                  new CustomEvent("phaser-input-focus", {
                    detail: { enabled: false },
                  })
                )
              }
              onBlur={() =>
                window.dispatchEvent(
                  new CustomEvent("phaser-input-focus", {
                    detail: { enabled: true },
                  })
                )
              }
              placeholder="Снежный лес с руинами..."
              disabled={isGenerating}
              className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-orange-500"
            />
            <Button
              onClick={handleSend}
              disabled={isGenerating || !input.trim()}
              size="icon"
              className="bg-orange-600 hover:bg-orange-500"
            >
              {isGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-zinc-500 mt-2 text-center">
            Опиши биом — Gemini сгенерирует карту
          </p>
        </div>
 
        {/* Инвентарь */}
        <div className="p-4 border-t border-orange-500/20 bg-zinc-900/80 space-y-3 overflow-y-auto max-h-[280px]">
          <div className="text-sm font-medium text-zinc-100">Инвентарь</div>
          {Object.entries(inventory).filter(([, c]) => c > 0).length === 0 ? (
            <div className="text-xs text-zinc-500 p-3 bg-zinc-800 rounded border border-zinc-700">
              Ломай объекты (F или ЛКМ)
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(inventory).map(
                ([id, count]) =>
                  count > 0 && (
                    <Button
                      key={id}
                      variant={selected === id ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleSelect(id)}
                      className={cn(
                        "justify-start px-2 h-9 text-[10px]",
                        selected === id
                          ? "bg-orange-600 hover:bg-orange-500 text-white border-orange-400"
                          : "border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400"
                      )}
                    >
                      <div
                        className={cn(
                          "w-3 h-3 rounded-sm mr-2 shrink-0",
                          getItemColor(id)
                        )}
                      />
                      <span className="truncate flex-1 text-left">
                        {ITEM_NAMES[id] ?? id}
                      </span>
                      <span className="ml-1 opacity-70 font-mono">×{count}</span>
                    </Button>
                  )
              )}
            </div>
          )}
 
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("phaser-save-world"))
              }
            >
              <Save className="mr-2 w-4 h-4" /> Сохранить
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400"
              asChild
            >
              <Link href="/gallery">
                <ImageIcon className="mr-2 w-4 h-4" /> Галерея
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}