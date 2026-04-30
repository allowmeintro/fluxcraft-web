"use server";
 
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateLandscapeSchema } from "@/lib/landscape-schema";
 
function buildPollinationsUrl(prompt: string, seed: number): string {
  // Берём только пользовательский промпт, без buildPrompt — он слишком длинный
  const hasCyrillic = /[а-яА-ЯёЁ]/.test(prompt);
  let finalPrompt = hasCyrillic
    ? prompt + ", game landscape, digital art, high quality"
    : prompt + ", game landscape, concept art, high quality, detailed";
 
  // Жёсткое ограничение длины промпта
  if (finalPrompt.length > 200) {
    finalPrompt = finalPrompt.slice(0, 200);
  }
 
  const encodedPrompt = encodeURIComponent(finalPrompt);
  // Используем turbo модель — она стабильнее flux на их серверах
  return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=576&seed=${seed}&nologo=true&model=turbo&enhance=false`;
}
 
export async function generateLandscapeAction(raw: unknown) {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, error: "UNAUTHORIZED" as const };
  }
 
  const parsed = generateLandscapeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: "VALIDATION" as const,
      issues: parsed.error.issues,
    };
  }
 
  const input = parsed.data;
  // Используем только оригинальный промпт пользователя — без buildPrompt
  const userPrompt = input.prompt;
 
  try {
    const seed = Math.floor(Math.random() * 1_000_000);
    const imageUrl = buildPollinationsUrl(userPrompt, seed);
 
    const gen = await prisma.generation.create({
      data: {
        userId: session.user.id,
        prompt: input.prompt,
        genre: input.genre,
        paramsJson: JSON.stringify({
          timeOfDay: input.timeOfDay,
          weather: input.weather,
          detail: input.detail,
          lighting: input.lighting,
        }),
        aspectRatio: input.aspectRatio,
        model: "pollinations/turbo",
        imageUrl,
        images: { create: { url: imageUrl } },
      },
      select: { id: true, imageUrl: true },
    });
 
    revalidatePath("/gallery");
    revalidatePath("/profile");
    return { ok: true as const, generationId: gen.id, imageUrl: gen.imageUrl! };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Generation error:", message);
    return { ok: false as const, error: "UNKNOWN_ERROR" as const, message };
  }
}