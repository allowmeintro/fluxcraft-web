"use client";
 
import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Send, Sparkles, Save, ImageIcon, Loader2 } from "lucide-react";
 
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
};
 
// Расширяем тип инвентаря для поддержки биомных блоков
type Inventory = Record<string, number>;
 
// Читабельные русские названия для биомных предметов
const ITEM_NAMES: Record<string, string> = {
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

// Цвет иконки для предмета в инвентаре
function getItemColor(id: string): string {
  if (id.includes('snow'))  return 'bg-blue-100 border border-blue-200';
  if (id.includes('magma')) return 'bg-red-950 border border-red-800';
  if (id.includes('sand'))  return 'bg-yellow-200 border border-yellow-300';
  if (id === 'tree')        return 'bg-green-700';
  if (id === 'rock')        return 'bg-zinc-500';
  if (id === 'ruins')       return 'bg-zinc-600';
  return 'bg-green-600';
}

export function GameShell() {

  const [inventory, setInventory] = useState<Inventory>({});
  const [selected, setSelected] = useState<string>("grass");
  // Ref всегда содержит актуальный selected — Phaser читает его напрямую,
  // не захватывая устаревшее замыкание
  const selectedRef = useRef<string>("grass");

  const handleSelect = useCallback((id: string) => {
    selectedRef.current = id;
    setSelected(id);
  }, []);
 
  const [messages, setMessages] = useState<Message[]>([
    { 
      role: "assistant", 
      content: "Привет! Я твой ИИ-помощник. Напиши описание биома (например: снежный лес с руинами), и я изменю мир через Flux." 
    },
  ]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
 
  // Инвентарь обновляется через onInventory колбэк из Phaser (единый источник правды)
  // block-collected используется только для side-effects если нужно

 
  const handleSend = useCallback(() => {
    if (!input.trim()) return;
 
    const userMessage: Message = { role: "user", content: input.trim() };
    setMessages(prev => [...prev, userMessage]);
    const currentPrompt = input.trim();
    setInput("");
 
    // Отправляем событие терраформирования в Phaser
    window.dispatchEvent(new CustomEvent('ai-terraform', {
      detail: { prompt: currentPrompt }
    }));
 
    // Добавляем ответ ассистента
    const assistantMsg: Message = {
      role: "assistant",
      content: `Принимаю команду: "${currentPrompt}"\n\nМир перестраивается... 🌍`,
    };
    setMessages(prev => [...prev, assistantMsg]);
  }, [input]);
 
  // Стабильные функции — читают ref, никогда не устаревают в Phaser
  const getSelectedTile = useCallback((): TileId => {
    const baseTile = selectedRef.current.split('_')[0] as TileId;
    const validTiles: TileId[] = ["grass", "water", "rock", "tree", "ruins", "empty"];
    return validTiles.includes(baseTile) ? baseTile : "grass";
  }, []); // пустой массив зависимостей — функция создаётся один раз

  const getSelectedItem = useCallback((): string => {
    return selectedRef.current;
  }, []); // пустой массив зависимостей — функция создаётся один раз
 
  // Функция для обработки инвентаря
  const handleInventory = useCallback((inv: Inventory) => {
    setInventory(inv);
  }, []);
 
  return (
    <div className="flex h-screen bg-zinc-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-orange-950/30 to-zinc-950 overflow-hidden">
      {/* Игровая область Phaser */}
      <div className="flex-1 relative">
        <PhaserCanvas 
          getSelectedTile={getSelectedTile}
          getSelectedItem={getSelectedItem}
          onInventory={handleInventory}
        />
        
        {/* Полупрозрачная плашка с подсказкой по управлению */}
        <div className="absolute bottom-4 left-4 bg-zinc-900/80 backdrop-blur-md border border-orange-500/30 rounded-lg px-4 py-3 text-xs text-zinc-300 shadow-lg shadow-orange-900/20 pointer-events-none z-20">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-orange-400 font-semibold">Управление:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-[10px] font-mono text-orange-300">W</kbd>
              <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-[10px] font-mono text-orange-300">A</kbd>
              <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-[10px] font-mono text-orange-300">S</kbd>
              <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-[10px] font-mono text-orange-300">D</kbd>
              <span>- движение</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-[10px] font-mono text-orange-300">F</kbd>
              <span>- ломать объекты</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-[10px] font-mono text-orange-300">ЛКМ</kbd>
              <span>- добыть блок</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-[10px] font-mono text-orange-300">Shift+ЛКМ</kbd>
              <span>- поставить выбранный</span>
            </span>
          </div>
        </div>
      </div>
 
      {/* Правая панель */}
      <div className="w-96 bg-zinc-900/80 border-l border-orange-500/20 backdrop-blur-md flex flex-col z-30">
        
        <div className="p-4 border-b border-orange-500/20 flex items-center gap-3 bg-zinc-950/80">
          <Sparkles className="w-6 h-6 text-orange-400" />
          <div className="flex-1">
            <h2 className="font-bold text-lg text-zinc-100">AI Biomecraft 2D</h2>
            <p className="text-xs text-zinc-500">ИИ меняет ландшафт по описанию</p>
          </div>
          <Badge variant="outline" className="bg-orange-500/20 text-orange-400 border-orange-500/30">Flux</Badge>
        </div>
 
        {/* Чат */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              <Card className={cn(
                "max-w-[85%] p-3 text-sm",
                msg.role === "user" ? "bg-orange-600 text-white" : "bg-zinc-800 text-zinc-100 border-zinc-700"
              )}>
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </Card>
            </div>
          ))}
          {isGenerating && (
            <div className="flex justify-start">
              <Card className="bg-zinc-800 p-3 flex items-center gap-2 border-zinc-700">
                <Loader2 className="animate-spin w-4 h-4 text-orange-400" />
                <span className="text-zinc-100">Генерирую биом...</span>
              </Card>
            </div>
          )}
        </div>
 
        {/* Поле ввода */}
        <div className="p-4 border-t border-orange-500/20 bg-zinc-950/80">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSend();
              }}
              onFocus={() => {
                window.dispatchEvent(new CustomEvent("phaser-input-focus", { detail: { enabled: false } }));
              }}
              onBlur={() => {
                window.dispatchEvent(new CustomEvent("phaser-input-focus", { detail: { enabled: true } }));
              }}
              placeholder="Снежный лес с руинами..."
              disabled={isGenerating}
              className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-orange-500 focus:ring-orange-500"
            />
            <Button
              onClick={handleSend}
              disabled={isGenerating || !input.trim()}
              size="icon"
              className="bg-orange-600 hover:bg-orange-500"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-zinc-500 mt-2 text-center">
            Напиши, какой биом хочешь
          </p>
        </div>
 
        {/* Инвентарь */}
        <div className="p-4 border-t border-orange-500/20 bg-zinc-900/80 space-y-3 overflow-y-auto max-h-[300px]">
          <div className="text-sm font-medium text-zinc-100">Инвентарь</div>
          {Object.entries(inventory).filter(([_, count]) => count > 0).length === 0 ? (
            <div className="text-xs text-zinc-500 p-3 bg-zinc-800 rounded border border-zinc-700">
              Ломай объекты (F или ЛКМ)
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(inventory).map(([id, count]) => 
                count && count > 0 && (
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
                    <div className={cn("w-3 h-3 rounded-sm mr-2 shrink-0", getItemColor(id))} />
                    <span className="truncate flex-1 text-left">{ITEM_NAMES[id] ?? id}</span>
                    <span className="ml-1 opacity-70 font-mono">×{count}</span>
                  </Button>
                )
              )}
            </div>
          )}
 
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" className="flex-1 border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400" onClick={() => window.dispatchEvent(new CustomEvent('phaser-save-world'))} >
              <Save className="mr-2 w-4 h-4" /> Сохранить
            </Button>
            <Button variant="outline" size="sm" className="flex-1 border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400" asChild>
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