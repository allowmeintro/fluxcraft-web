import { NextResponse } from "next/server";

const MAP_W = 64;
const MAP_H = 64;

const SYSTEM_PROMPT = `You are an AI game world generator for a 2D sandbox game called FluxCraft.
You control the game world by responding with JSON commands.
Player position is provided as x,y tile coordinates (0-63).

Available tile characters:
G=grass W=water R=rock T=tree U=ruins E=empty
S=snow_grass I=ice_rock P=pine_tree k=spruce
M=magma_floor V=volcanic_rock C=coal t=lava_flow s=hot_rock
D=sand N=sand_rock K=cactus q=palm r=light_sand
H=house 1=building 2=road 3=fence/wall B=cobblestone
4=campfire 5=fountain Y=well 6=grave A=lamp
Z=chest O=barrel X=bush J=mushroom Q=tent
7=red_tree 8=golden_tree g=birch f=dark_forest y=magic_tree
9=stream l=clear_lake m=flower_field p=flowers/sakura
o=artifact x=treasure/gold z=dark_ash/ember
v=ice_block w=frozen_lake u=pure_snow
i=brown_rock n=brick j=overgrown_ruins

You have 3 command types. Choose based on request:

1. generate_map — full world replacement. Use when: "создай мир", "сгенерируй биом", new biome type.
{
  "command": "generate_map",
  "biome": "snow|lava|desert|forest|city|default",
  "description": "Russian description 1-2 sentences",
  "map": ["64chars"... x64 rows]
}
IMPORTANT for generate_map: Use organic, noise-like distribution. NO stripes, NO repeating rows, NO grid patterns. Each row must be unique.

2. modify_area — change tiles in a zone. Use when: change area around player, replace specific things.
{
  "command": "modify_area",
  "description": "Russian description",
  "changes": [{"x": 30, "y": 30, "tile": "T"}, ...]
}

3. place_objects — place objects relative to player. Use when: "добавь рядом", "поставь около меня", specific objects near player.
{
  "command": "place_objects",
  "description": "Russian description",
  "objects": [{"dx": 1, "dy": 0, "tile": "Z"}, {"dx": -1, "dy": 0, "tile": "Z"}, ...]
}
dx/dy are offsets from player position in tiles.

Respond ONLY with valid JSON. No markdown. No explanation outside JSON.`;

export async function POST(req: Request) {
  try {
    const { prompt, playerX, playerY, isPlaceCommand } = await req.json();
    if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY не задан в .env");

    const px = playerX ?? 32;
    const py = playerY ?? 32;

    const userMsg = `Player is at tile x=${px}, y=${py} on a ${MAP_W}x${MAP_H} map.
Request: "${prompt}"

${isPlaceCommand
  ? 'This is a PLACE command - use "place_objects" with dx/dy offsets from player.'
  : 'Choose the best command type based on the request scope.'}

Respond ONLY with JSON.`;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        temperature: 0.7,
        max_tokens: 8192,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq API ${res.status}: ${errText.slice(0, 300)}`);
    }

    const groqRes = await res.json();
    const rawText: string = groqRes?.choices?.[0]?.message?.content ?? "";
    if (!rawText) throw new Error("Groq вернул пустой ответ");

    const clean = rawText.replace(/```json|```/g, "").trim();
    const data = JSON.parse(clean);

    // Нормализуем generate_map
    if (data.command === "generate_map" && Array.isArray(data.map)) {
      const map: string[] = [];
      for (let y = 0; y < MAP_H; y++) {
        const row: string = data.map[y] ?? "";
        map.push(row.padEnd(MAP_W, "G").slice(0, MAP_W));
      }
      data.map = map;
    }

    // Если AI не указал command — считаем это generate_map
    if (!data.command && Array.isArray(data.map)) {
      data.command = "generate_map";
      const map: string[] = [];
      for (let y = 0; y < MAP_H; y++) {
        const row: string = data.map[y] ?? "";
        map.push(row.padEnd(MAP_W, "G").slice(0, MAP_W));
      }
      data.map = map;
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[game-ai]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Неизвестная ошибка" },
      { status: 500 }
    );
  }
}