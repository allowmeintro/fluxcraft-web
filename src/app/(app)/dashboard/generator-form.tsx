"use client";
 
import * as React from "react";
import { Download, ImageIcon, Share2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
 
import { generateLandscapeAction } from "./actions";
import { genres, aspectRatios, type GenerateLandscapeInput } from "@/lib/landscape-schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
 
const genreLabels: Record<(typeof genres)[number], string> = {
  FANTASY: "Fantasy",
  SCI_FI: "Sci‑Fi",
  CYBERPUNK: "Cyberpunk",
  POST_APOCALYPTIC: "Post‑Apocalyptic",
  REALISTIC: "Realistic",
  PIXEL_ART: "Pixel Art",
  LOW_POLY: "Low‑Poly",
};
 
const templates: Array<{ title: string; prompt: string; genre: GenerateLandscapeInput["genre"] }> = [
  { title: "Эпический фэнтези‑лес на рассвете", prompt: "Epic fantasy forest valley with ancient ruins, birds, distant mountains", genre: "FANTASY" },
  { title: "Киберпанк‑мегаполис ночью", prompt: "Cyberpunk megacity skyline at night, neon, rain, flying vehicles", genre: "CYBERPUNK" },
  { title: "Постапокалиптическая пустошь", prompt: "Abandoned highway through a ruined city, overgrown vegetation, dramatic clouds", genre: "POST_APOCALYPTIC" },
  { title: "Sci‑Fi планета с кольцами", prompt: "Alien planet landscape with rings in the sky, futuristic outpost, cinematic", genre: "SCI_FI" },
];
 
function clamp01(v: number) {
  return Math.max(0, Math.min(100, v));
}
 
export function GeneratorForm() {
  const [input, setInput] = React.useState<GenerateLandscapeInput>({
    prompt: "",
    genre: "FANTASY",
    timeOfDay: 70,
    weather: 35,
    detail: 80,
    lighting: 75,
    aspectRatio: "16:9",
    model: "black-forest-labs/flux-schnell",
    useGameBiomeTemplate: false,
  });
 
  const [isPending, startTransition] = React.useTransition();
  const [progress, setProgress] = React.useState<number>(0);
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [isImageLoading, setIsImageLoading] = React.useState(false);
  const [generationId, setGenerationId] = React.useState<string | null>(null);
 
  React.useEffect(() => {
    if (!isPending) return;
    setProgress(10);
    const t1 = window.setTimeout(() => setProgress(35), 600);
    const t2 = window.setTimeout(() => setProgress(60), 1400);
    const t3 = window.setTimeout(() => setProgress(85), 2600);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [isPending]);
 
  function onGenerate() {
    setImageUrl(null);
    setGenerationId(null);
    setIsImageLoading(false);
    startTransition(async () => {
      const res = await generateLandscapeAction(input);
      if (!res.ok) {
        toast.error(
          res.error === "UNAUTHORIZED"
            ? "Нужно войти в аккаунт"
            : res.error === "VALIDATION"
              ? "Проверьте промпт и параметры"
              : res.error === "UNKNOWN_ERROR"
                ? "Неизвестная ошибка сервера"
                : "Ошибка генерации",
        );
        return;
      }
      setProgress(100);
      setImageUrl(res.imageUrl);
      setIsImageLoading(true);
      setGenerationId(res.generationId);
      toast.success("Готово! Изображение сохранено в галерею.");
    });
  }
 
  const promptJson = React.useMemo(() => {
    return JSON.stringify(
      {
        prompt: input.prompt,
        genre: input.genre,
        aspectRatio: input.aspectRatio,
        params: {
          timeOfDay: input.timeOfDay,
          weather: input.weather,
          detail: input.detail,
          lighting: input.lighting,
        },
        model: input.model,
      },
      null,
      2,
    );
  }, [input]);
 
  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="overflow-hidden bg-zinc-900/80 border-orange-500/20 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-zinc-100">
            <Wand2 className="h-5 w-5 text-orange-400" />
            Генератор пейзажей
          </CardTitle>
          <CardDescription className="text-zinc-400">Текстовый промпт + параметры → Flux генерирует game‑ready landscape.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="prompt" className="text-zinc-300">Промпт</Label>
              <Badge variant="secondary" className="hidden sm:inline-flex bg-orange-500/20 text-orange-400 border-orange-500/30">
                {genreLabels[input.genre]} · {input.aspectRatio}
              </Badge>
            </div>
            <Textarea
              id="prompt"
              value={input.prompt}
              onChange={(e) => setInput((s) => ({ ...s, prompt: e.target.value }))}
              placeholder="Например: vast fantasy valley, ancient castle ruins, mist, cinematic, high detail..."
              className="min-h-[180px] bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-orange-500 focus:ring-orange-500"
            />
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <Button
                  key={t.title}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setInput((s) => ({ ...s, prompt: t.prompt, genre: t.genre }))}
                  className="border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400 hover:border-orange-500/50"
                >
                  <Sparkles className="h-4 w-4" />
                  {t.title}
                </Button>
              ))}
            </div>
          </div>
 
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-zinc-300">Жанр</Label>
              <Select
                value={input.genre}
                onValueChange={(v) => setInput((s) => ({ ...s, genre: v as GenerateLandscapeInput["genre"] }))}
              >
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100 focus:border-orange-500 focus:ring-orange-500">
                  <SelectValue placeholder="Выберите жанр" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {genres.map((g) => (
                    <SelectItem key={g} value={g} className="text-zinc-100 focus:bg-orange-500/20 focus:text-orange-400">
                      {genreLabels[g]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
 
            <div className="space-y-2">
              <Label className="text-zinc-300">Соотношение сторон</Label>
              <Select
                value={input.aspectRatio}
                onValueChange={(v) => setInput((s) => ({ ...s, aspectRatio: v as GenerateLandscapeInput["aspectRatio"] }))}
              >
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100 focus:border-orange-500 focus:ring-orange-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {aspectRatios.map((r) => (
                    <SelectItem key={r} value={r} className="text-zinc-100 focus:bg-orange-500/20 focus:text-orange-400">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
 
            <div className="space-y-2">
              <Label className="text-zinc-300">Модель</Label>
              <Select
                value={input.model}
                onValueChange={(v) => setInput((s) => ({ ...s, model: v as GenerateLandscapeInput["model"] }))}
              >
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100 focus:border-orange-500 focus:ring-orange-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="black-forest-labs/flux-schnell" className="text-zinc-100 focus:bg-orange-500/20 focus:text-orange-400">Flux Schnell (быстрее)</SelectItem>
                  <SelectItem value="black-forest-labs/flux-pro" className="text-zinc-100 focus:bg-orange-500/20 focus:text-orange-400">Flux Pro (качество)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
 
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-zinc-300">Время суток</Label>
                <span className="text-xs text-orange-400">{input.timeOfDay}</span>
              </div>
              <Slider value={[input.timeOfDay]} max={100} step={1} onValueChange={(v) => setInput((s) => ({ ...s, timeOfDay: clamp01(v[0] ?? 0) }))} className="py-4" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-zinc-300">Погода</Label>
                <span className="text-xs text-orange-400">{input.weather}</span>
              </div>
              <Slider value={[input.weather]} max={100} step={1} onValueChange={(v) => setInput((s) => ({ ...s, weather: clamp01(v[0] ?? 0) }))} className="py-4" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-zinc-300">Детализация</Label>
                <span className="text-xs text-orange-400">{input.detail}</span>
              </div>
              <Slider value={[input.detail]} max={100} step={1} onValueChange={(v) => setInput((s) => ({ ...s, detail: clamp01(v[0] ?? 0) }))} className="py-4" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-zinc-300">Освещение</Label>
                <span className="text-xs text-orange-400">{input.lighting}</span>
              </div>
              <Slider value={[input.lighting]} max={100} step={1} onValueChange={(v) => setInput((s) => ({ ...s, lighting: clamp01(v[0] ?? 0) }))} className="py-4" />
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button className="w-full bg-orange-600 hover:bg-orange-500 text-white" onClick={onGenerate} disabled={isPending}>
            {isPending ? "Генерация..." : "Сгенерировать"}
          </Button>
          {isPending && (
            <div className="w-full space-y-2">
              <Progress value={progress} className="bg-zinc-800" />
              <p className="text-xs text-zinc-500">Генерация занимает 10–30 секунд, подождите...</p>
            </div>
          )}
        </CardFooter>
      </Card>
 
      <div className="space-y-6">
        <Card className="bg-zinc-900/80 border-orange-500/20 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-zinc-100">
              <ImageIcon className="h-5 w-5 text-orange-400" />
              Результат
            </CardTitle>
            <CardDescription className="text-zinc-400">Изображение сохраняется в Prisma и появляется в галерее.</CardDescription>
          </CardHeader>
          <CardContent>
            {isPending ? (
              <div className="space-y-3">
                <Skeleton className="aspect-[16/9] w-full rounded-xl bg-zinc-800" />
                <Skeleton className="h-4 w-2/3 bg-zinc-800" />
                <Skeleton className="h-4 w-1/2 bg-zinc-800" />
              </div>
            ) : imageUrl ? (
              <div className="space-y-4">
                <div className="relative overflow-hidden rounded-xl border border-orange-500/20">
                  {isImageLoading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/80">
                      <div className="flex flex-col items-center gap-2">
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
                        <p className="text-sm text-zinc-300">Pollinations генерирует...</p>
                      </div>
                    </div>
                  )}
                  {/* Используем обычный img вместо Next/Image — Pollinations URL слишком длинный для проксирования */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt="Generated landscape"
                    className={`h-auto w-full rounded-xl transition-opacity duration-500 ${isImageLoading ? "opacity-0" : "opacity-100"}`}
                    onLoad={() => setIsImageLoading(false)}
                    onError={() => {
                      setIsImageLoading(false);
                      toast.error("Не удалось загрузить изображение. Попробуйте сгенерировать заново.");
                      setImageUrl(null);
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400">
                    <a href={imageUrl} download target="_blank" rel="noreferrer">
                      <Download className="h-4 w-4" />
                      Скачать PNG
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await navigator.clipboard.writeText(imageUrl);
                      toast.success("Ссылка скопирована");
                    }}
                    className="border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400"
                  >
                    <Share2 className="h-4 w-4" />
                    Поделиться
                  </Button>
                  <Button variant="secondary" onClick={onGenerate} className="bg-orange-600 hover:bg-orange-500 text-white">
                    <Wand2 className="h-4 w-4" />
                    Регенерировать
                  </Button>
                  {generationId && (
                    <Badge variant="outline" className="ml-auto bg-orange-500/20 text-orange-400 border-orange-500/30">
                      id: {generationId.slice(0, 8)}
                    </Badge>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-700 p-6 text-sm text-zinc-500">
                Нажмите «Сгенерировать», чтобы получить результат.
              </div>
            )}
          </CardContent>
        </Card>
 
        <Card className="bg-zinc-900/80 border-orange-500/20 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-zinc-100">Экспорт промпта как JSON</CardTitle>
            <CardDescription className="text-zinc-400">Можно сохранить параметры и использовать в пайплайне геймдева (Unity/Godot).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="max-h-[280px] overflow-auto rounded-xl border border-zinc-700 bg-zinc-800/40 p-3 text-xs leading-relaxed text-zinc-300">
              {promptJson}
            </pre>
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(promptJson);
                toast.success("JSON скопирован");
              }}
              className="border-zinc-700 text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400"
            >
              Скопировать JSON
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}