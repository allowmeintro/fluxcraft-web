import { z } from "zod";

export const aspectRatios = ["16:9", "9:16", "21:9", "1:1"] as const;
export const genres = [
  "FANTASY",
  "SCI_FI",
  "CYBERPUNK",
  "POST_APOCALYPTIC",
  "REALISTIC",
  "PIXEL_ART",
  "LOW_POLY",
] as const;

export type Genre = (typeof genres)[number];
export type AspectRatio = (typeof aspectRatios)[number];

export const generateLandscapeSchema = z.object({
  prompt: z.string().trim().min(10, "Слишком короткий промпт").max(1000),
  genre: z.enum(genres),
  timeOfDay: z.number().min(0).max(100),
  weather: z.number().min(0).max(100),
  detail: z.number().min(0).max(100),
  lighting: z.number().min(0).max(100),
  aspectRatio: z.enum(aspectRatios),
  model: z.enum(["black-forest-labs/flux-schnell", "black-forest-labs/flux-pro"]).default(
    "black-forest-labs/flux-schnell",
  ),
  /** Если true — используется шаблон 2D game biome (параллакс / платформер) вместо классического buildPrompt. */
  useGameBiomeTemplate: z.boolean().optional().default(false),
});

export type GenerateLandscapeInput = z.infer<typeof generateLandscapeSchema>;

export function buildPrompt(input: GenerateLandscapeInput) {
  const styleByGenre: Record<Genre, string> = {
    FANTASY: "epic fantasy game landscape, high fantasy, matte painting, concept art",
    SCI_FI: "sci-fi game environment, futuristic landscape, cinematic concept art",
    CYBERPUNK: "cyberpunk cityscape, neon lights, rainy streets, cinematic, concept art",
    POST_APOCALYPTIC: "post-apocalyptic environment, ruined city, overgrown nature, concept art",
    REALISTIC: "photorealistic game environment, realistic lighting, high detail",
    PIXEL_ART: "pixel art game background, 16-bit, crisp pixels, limited palette",
    LOW_POLY: "low-poly 3D game environment, clean geometry, stylized, soft lighting",
  };

  const day = input.timeOfDay;
  const weather = input.weather;
  const detail = input.detail;
  const lighting = input.lighting;

  const timeText =
    day < 20 ? "night" : day < 40 ? "sunset" : day < 60 ? "daylight" : day < 80 ? "golden hour" : "sunrise";
  const weatherText =
    weather < 20
      ? "clear skies"
      : weather < 40
        ? "misty"
        : weather < 60
          ? "cloudy"
          : weather < 80
            ? "rainy"
            : "stormy";

  const detailText = detail < 30 ? "simple shapes" : detail < 70 ? "detailed" : "ultra-detailed";
  const lightText = lighting < 30 ? "soft lighting" : lighting < 70 ? "cinematic lighting" : "dramatic lighting";

  return [
    input.prompt,
    styleByGenre[input.genre],
    `time of day: ${timeText}`,
    `weather: ${weatherText}`,
    `${detailText}`,
    `${lightText}`,
    "game-ready background, no watermark, no text",
  ].join(", ");
}

/** Шаблон для 2D-игры: фон биома в духе side-scroller + parallax layers (как в дипломном описании). */
export function buildGameBiomePrompt(input: GenerateLandscapeInput) {
  const styleByGenre: Record<Genre, string> = {
    FANTASY: "fantasy biome, magical forest and ruins, readable silhouettes",
    SCI_FI: "sci-fi alien biome, strange plants and tech ruins, readable silhouettes",
    CYBERPUNK: "cyberpunk biome, neon accents, wet surfaces, readable silhouettes",
    POST_APOCALYPTIC: "post-apocalyptic biome, overgrown ruins, dust, readable silhouettes",
    REALISTIC: "stylized realistic 2d biome, painterly but flat, readable silhouettes",
    PIXEL_ART: "pixel art biome, crisp pixels, limited palette, readable game tiles",
    LOW_POLY: "flat stylized low-poly look in 2d, clean shapes, readable silhouettes",
  };

  const day = input.timeOfDay;
  const weather = input.weather;
  const detail = input.detail;
  const lighting = input.lighting;

  const timeText =
    day < 20 ? "night" : day < 40 ? "sunset" : day < 60 ? "daylight" : day < 80 ? "golden hour" : "sunrise";
  const weatherText =
    weather < 20
      ? "clear skies"
      : weather < 40
        ? "misty"
        : weather < 60
          ? "cloudy"
          : weather < 80
            ? "rainy"
            : "stormy";

  const detailText = detail < 30 ? "clean simple shapes" : detail < 70 ? "detailed" : "highly detailed";
  const lightText = lighting < 30 ? "soft flat lighting" : lighting < 70 ? "cinematic flat lighting" : "dramatic lighting";

  const template =
    "2d game background, side-scrolling platformer level design, flat 2d vector art, digital illustration, highly detailed, vibrant colors, clear outlines, seamless environment, concept art, game asset, parallax layers, no perspective distortion";

  const negativeHints =
    "no 3d render, no realistic photography, no isometric, no heavy perspective, no depth of field, no blur, no characters, no text, no watermark";

  return [
    template,
    styleByGenre[input.genre],
    `scene idea: ${input.prompt}`,
    `time:${timeText}`,
    `weather:${weatherText}`,
    detailText,
    lightText,
    negativeHints,
  ].join(", ");
}

/** Тело запроса для кнопки «Новый биом» в игре (валидно для generateLandscapeSchema). */
export function getDefaultGameBiomeInput(): GenerateLandscapeInput {
  return {
    prompt:
      "Mystical valley with ancient ruins, glowing mushrooms, mossy stones, distant fog, parallax-ready layers",
    genre: "FANTASY",
    timeOfDay: 58,
    weather: 42,
    detail: 82,
    lighting: 72,
    aspectRatio: "16:9",
    model: "black-forest-labs/flux-schnell",
    useGameBiomeTemplate: true,
  };
}

