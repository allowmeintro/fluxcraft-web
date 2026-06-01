import { NextResponse } from "next/server";

const MAP_W = 64;
const MAP_H = 64;

type BiomeKey = "default" | "snow" | "lava" | "desert" | "mythic" | "forest" | "swamp" | "city";

interface BiomeDef {
  water: string; ground: string; ground2: string;
  tree: string; rock: string;
  extras: string[];
  treeDens: number; rockDens: number; extraDens: number;
}

const BIOMES: Record<BiomeKey, BiomeDef> = {
  default: { water:"W", ground:"G", ground2:"G", tree:"T", rock:"R",
    extras:["U","X","J","4","9"], treeDens:0.09, rockDens:0.05, extraDens:0.03 },
  forest:  { water:"W", ground:"G", ground2:"G", tree:"T", rock:"R",
    extras:["U","X","J","7","4"], treeDens:0.22, rockDens:0.03, extraDens:0.04 },
  snow:    { water:"W", ground:"S", ground2:"S", tree:"P", rock:"I",
    extras:["i","z","L","6","0"], treeDens:0.08, rockDens:0.07, extraDens:0.06 },
  lava:    { water:"F", ground:"M", ground2:"M", tree:"C", rock:"V",
    extras:["r","0","4","Z","U"], treeDens:0.06, rockDens:0.10, extraDens:0.05 },
  desert:  { water:"W", ground:"D", ground2:"D", tree:"K", rock:"N",
    extras:["U","Y","5","6","0"], treeDens:0.05, rockDens:0.06, extraDens:0.04 },
  mythic:  { water:"W", ground:"G", ground2:"G", tree:"8", rock:"y",
    extras:["c","g","q","U","7"], treeDens:0.08, rockDens:0.05, extraDens:0.09 },
  swamp:   { water:"W", ground:"B", ground2:"G", tree:"T", rock:"R",
    extras:["J","p","X","U","9"], treeDens:0.12, rockDens:0.03, extraDens:0.07 },
  city:    { water:"W", ground:"G", ground2:"G", tree:"H", rock:"R",
    extras:["A","Z","O","5","b"], treeDens:0.06, rockDens:0.04, extraDens:0.06 },
};

function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 0x100000000;
  };
}

function generateIslandMap(biome: BiomeKey, seed: number): string[] {
  const rng = seededRng(seed);
  const b = BIOMES[biome] ?? BIOMES.default;
  const grid: string[][] = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(b.water));

  const cx = MAP_W / 2 + (rng() - 0.5) * 6;
  const cy = MAP_H / 2 + (rng() - 0.5) * 6;
  const baseR = MAP_W * 0.36;
  const phases = [rng()*Math.PI*2, rng()*Math.PI*2, rng()*Math.PI*2];

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const dx = x - cx, dy = y - cy;
      const angle = Math.atan2(dy, dx);
      const noise = 1
        + 0.20 * Math.sin(angle * 3 + phases[0])
        + 0.12 * Math.sin(angle * 6 + phases[1])
        + 0.08 * Math.sin(angle * 11 + phases[2]);
      if (Math.sqrt(dx*dx + dy*dy) < baseR * noise) {
        grid[y][x] = b.ground;
      }
    }
  }

  const numSats = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < numSats; i++) {
    const sx = 4 + Math.floor(rng() * (MAP_W - 8));
    const sy = 4 + Math.floor(rng() * (MAP_H - 8));
    const sr = 2 + Math.floor(rng() * 4);
    const dist = Math.sqrt((sx - cx)**2 + (sy - cy)**2);
    if (dist < baseR + 3) continue;
    for (let dy = -sr; dy <= sr; dy++)
      for (let dx = -sr; dx <= sr; dx++) {
        const nx = sx+dx, ny = sy+dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        if (dx*dx + dy*dy <= sr*sr) grid[ny][nx] = b.ground;
      }
  }

  for (let y = 1; y < MAP_H-1; y++) {
    for (let x = 1; x < MAP_W-1; x++) {
      if (grid[y][x] === b.water) continue;
      const r = rng();
      if      (r < b.treeDens)                      grid[y][x] = b.tree;
      else if (r < b.treeDens + b.rockDens)         grid[y][x] = b.rock;
      else if (r < b.treeDens + b.rockDens + b.extraDens) {
        grid[y][x] = b.extras[Math.floor(rng() * b.extras.length)];
      } else if (rng() < 0.12) {
        grid[y][x] = b.ground2;
      }
    }
  }

  const numPatches = 4 + Math.floor(rng() * 5);
  for (let i = 0; i < numPatches; i++) {
    const px = 5 + Math.floor(rng() * (MAP_W - 10));
    const py = 5 + Math.floor(rng() * (MAP_H - 10));
    if (grid[py][px] === b.water) continue;
    const pr = 1 + Math.floor(rng() * 3);
    const pTile = b.extras[Math.floor(rng() * b.extras.length)];
    for (let dy = -pr; dy <= pr; dy++)
      for (let dx = -pr; dx <= pr; dx++) {
        const nx = px+dx, ny = py+dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || grid[ny][nx] === b.water) continue;
        if (dx*dx + dy*dy <= pr*pr && rng() < 0.65) grid[ny][nx] = pTile;
      }
  }

  if (biome === "mythic") {
    for (let i = 0; i < 8; i++) {
      const px = 6 + Math.floor(rng() * (MAP_W - 12));
      const py = 6 + Math.floor(rng() * (MAP_H - 12));
      if (grid[py][px] === "W") continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = px+dx, ny = py+dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || grid[ny][nx] === "W") continue;
          const t = rng();
          grid[ny][nx] = t < 0.35 ? "c" : t < 0.60 ? "y" : t < 0.75 ? "g" : t < 0.85 ? "q" : "8";
        }
    }
  }
  if (biome === "snow") {
    for (let i = 0; i < 4; i++) {
      const px = 5 + Math.floor(rng() * (MAP_W - 10));
      const py = 5 + Math.floor(rng() * (MAP_H - 10));
      if (grid[py][px] === "W") continue;
      const lr = 2 + Math.floor(rng() * 4);
      for (let dy = -lr; dy <= lr; dy++)
        for (let dx = -lr; dx <= lr; dx++) {
          const nx = px+dx, ny = py+dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || grid[ny][nx] === "W") continue;
          if (dx*dx + dy*dy <= lr*lr) grid[ny][nx] = rng() < 0.6 ? "L" : "i";
        }
    }
  }
  if (biome === "lava") {
    let lx = Math.floor(cx), ly = Math.floor(rng() * MAP_H * 0.3) + 5;
    for (let step = 0; step < 40; step++) {
      if (lx < 0 || lx >= MAP_W || ly < 0 || ly >= MAP_H) break;
      if (grid[ly][lx] !== b.water) grid[ly][lx] = "F";
      if (lx+1 < MAP_W && grid[ly][lx+1] !== b.water) grid[ly][lx+1] = "F";
      lx += Math.floor(rng() * 3) - 1;
      ly += 1;
    }
  }
  if (biome === "default" || biome === "forest") {
    const rx = Math.floor(cx) + Math.floor(rng()*5) - 2;
    const ry = Math.floor(cy) + Math.floor(rng()*5) - 2;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = rx+dx, ny = ry+dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || grid[ny][nx] === "W") continue;
        if (Math.abs(dx) === 2 || Math.abs(dy) === 2) grid[ny][nx] = "U";
      }
  }
  if (biome === "desert") {
    const ox = Math.floor(cx + (rng()-0.5)*10);
    const oy = Math.floor(cy + (rng()-0.5)*10);
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const nx = ox+dx, ny = oy+dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const d2 = dx*dx + dy*dy;
        if (d2 <= 2) { grid[ny][nx] = "W"; continue; }
        if (d2 <= 9 && grid[ny][nx] !== "W") grid[ny][nx] = rng() < 0.5 ? "G" : "K";
      }
  }

  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const nx = Math.floor(cx)+dx, ny = Math.floor(cy)+dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      if (grid[ny][nx] !== b.water) grid[ny][nx] = b.ground;
    }

  return grid.map(row => row.join(""));
}

const SYSTEM_PROMPT = `You are an expert AI game master for FluxCraft — a 2D sandbox game.
You speak Russian with the player and control the game world via JSON commands.
Map is 64×64 tiles. Player position is tile coordinates x,y (0-63).

═══════════════════════════════════════════════════
TILE CHARACTERS
═══════════════════════════════════════════════════
GROUND: G=grass  S=snow_ground  M=magma_floor  D=sand  B=bog/swamp
SOLID:  R=rock  T=tree  U=ruins  W=water  P=pine(snow)
        V=volcanic_rock  C=coal  K=cactus  N=sand_rock  F=lava_pool  L=frozen_lake
        I=snow_rock(rock+blue_tint)
OBJECTS: H=house  A=lamp  Z=chest  O=barrel  X=bush  J=mushroom  Y=well
         4=campfire  5=fountain  6=grave  7=red_tree  8=gold_tree  9=stream
         c=crystal  y=mythic_rock  i=ICE_TILE  q=quartz  b=board  a=glass  e=concrete
         p=plant  g=glow_mushroom  r=ash  o=coral  z=snowball  0=dark_stone
         d=dirt

⚠️ ВАЖНО: i (строчная) = настоящий лёд (tile-ice). I (заглавная) = снежный камень.

═══════════════════════════════════════════════════
КОМАНДЫ — ВЫБИРАЙ ТОЧНО ПО ОПИСАНИЮ
═══════════════════════════════════════════════════

━━━ 1. generate_map ━━━
КОГДА: игрок хочет СОВЕРШЕННО НОВЫЙ мир/биом/ландшафт целиком.
Примеры: «снежный мир», «создай вулканический остров», «новая пустыня», «перегенерируй карту»,
         «снежный лес с горными вершинами», «вулканический остров с лавой и руинами»,
         «пустыня с оазисом», «мифический лес с кристаллами», «болотный биом с грибами»,
         «заброшенный город с дорогами», «лесной биом», «сделай снег», «сделай лаву».
{
  "command": "generate_map",
  "biome": "snow|lava|desert|forest|city|swamp|mythic|default",
  "description": "..."
}
⚠️ НЕ добавляй поле map — сервер сам генерирует карту!
Биомы: снег/зима/лёд/горы/ели→snow, лава/огонь/вулкан/магма→lava,
        пустыня/песок/оазис/кактус→desert, лес/джунгли/деревья→forest,
        болото/туман/грибы→swamp, город/здания/дороги→city,
        магия/кристаллы/мифика/руны→mythic, луг/обычный→default

━━━ 2. patch_tiles ━━━
КОГДА: игрок хочет заменить ВСЕ тайлы одного типа на другой ПО ВСЕЙ карте.
Примеры:
  «замени всю траву на снег» → from:G, to:S
  «все камни замени на кристаллы» → from:R, to:c
  «замени воду на лаву везде» → from:W, to:F
  «замени камни на лёд» → from:R, to:i  (i строчная = настоящий лёд!)
  «замени траву на грязь» → from:G, to:d
  «все деревья в кристаллы» → from:T, to:c
{
  "command": "patch_tiles",
  "from": "G",
  "to": "S",
  "description": "замена тайлов по всей карте"
}

━━━ 3. modify_area ━━━
КОГДА: игрок хочет изменить КОНКРЕТНУЮ ОБЛАСТЬ (часть карты, зону, регион).
Примеры: «добавь лес на севере», «сделай озеро в центре», «засыпь снегом правую половину».
Лимит 800 тайлов.
{
  "command": "modify_area",
  "description": "что изменено",
  "changes": [{"x": 30, "y": 30, "tile": "T"}, ...]
}

━━━ 4. place_objects ━━━
КОГДА: игрок хочет разместить объекты РЯДОМ С СОБОЙ (dx/dy -8..+8 от позиции).
Примеры: «поставь рядом со мной кристаллы», «положи около меня сундуки».
{
  "command": "place_objects",
  "description": "...",
  "objects": [{"dx": 1, "dy": 0, "tile": "Z"}, ...]
}

━━━ 5. build ━━━
КОГДА: игрок хочет построить структуру — замок, дом, башню, стену, крепость, форт.
{
  "command": "build",
  "type": "castle|house|tower|wall|fort",
  "width": 7,
  "height": 5,
  "material": "rock|glass|ice|concrete|board|mythic_rock|crystal|volcanic_rock",
  "description": "что строю"
}
ПРАВИЛА РАЗМЕРОВ (если не указан):
  замок/крепость/форт → 9×7, дом → 5×5, башня → 3×8, стена → 12×2
МАТЕРИАЛЫ: обычный→rock, ледяной→ice, стеклянный→glass, бетонный→concrete,
  деревянный→board, мифический→mythic_rock, вулканический→volcanic_rock, кристальный→crystal

━━━ 6. clarify ━━━
КОГДА: запрос АБСОЛЮТНО неоднозначен и невозможно угадать намерение.
{
  "command": "clarify",
  "question": "вопрос (1-2 вопроса)",
  "examples": ["вариант 1", "вариант 2", "вариант 3"]
}
НЕ спрашивай если хоть что-то ясно:
  ✗ «снежный лес» → generate_map:snow
  ✗ «вулканический остров» → generate_map:lava
  ✗ «пустыня с оазисом» → generate_map:desert
  ✗ «мифический лес с кристаллами» → generate_map:mythic
  ✗ «болотный биом с грибами» → generate_map:swamp
  ✗ «заброшенный город» → generate_map:city
  ✗ «построй замок» → build:castle
  ✗ «построй дом» → build:house
  ✗ «замени траву на снег» → patch_tiles G→S
  ✗ «засыпь север снегом» → modify_area север y0..20 тайлами S

═══════════════════════════════════════════════════
ДЕРЕВО РЕШЕНИЙ
═══════════════════════════════════════════════════
⚠️ ВАЖНО: «построй/возведи/сооруди [структуру] [из материала]» → build! Даже если материал природный (камень, лёд, дерево).

1. «построй/возведи/сооруди/сделай структуру (дом, замок, башню, стену, крепость, форт)»? → build
2. Запрос содержит биом/ландшафт/мир/природу?  → generate_map
3. «замени ВСЕ [тип] на [тип]»?                → patch_tiles
4. «измени область / часть / регион»?          → modify_area
5. «поставь рядом со мной»?                    → place_objects
6. АБСОЛЮТНО непонятно?                        → clarify

RESPOND ONLY WITH VALID JSON. NO MARKDOWN. NO TEXT OUTSIDE JSON.`;

// ═══════════════════════════════════════════════════════════════
// Улучшенные классификаторы — ловят все биомные запросы
// ═══════════════════════════════════════════════════════════════
function isMapGenRequest(prompt: string): boolean {
  const t = prompt.toLowerCase();
  // Явная генерация нового мира/биома
  if (/нов[ыайе]+\s+карт|генер|сгенер|создай\s+мир|новый\s+мир|перегенер/.test(t)) return true;
  if (/^(снег|снежн|лава|лавов|пустын|мифич|лес|болот|город)\w*$/.test(t.trim())) return true;
  if (/(snow|lava|desert|mythic|forest|swamp|city)\s+(biome|world|map)/.test(t)) return true;
  // Биомные прилагательные + любое существительное (лес, остров, мир, биом, ландшафт...)
  if (/(снежн|ледян|зимн|арктич)\w+/.test(t)) return true;
  if (/(лавов|вулкан|огненн|магм)\w+/.test(t)) return true;
  if (/(пустынн|песчан|сахарск|аридн)\w+/.test(t)) return true;
  if (/(мифичес|кристальн|магичес|волшебн)\w+/.test(t)) return true;
  if (/(болотн|топян|трясинн)\w+/.test(t)) return true;
  if (/(городск|урбан|заброшенн\w+\s+город)/.test(t)) return true;
  if (/(лесн|джунгл|чащ|роща|тропичес)\w+/.test(t)) return true;
  // Прямые биомные слова
  if (/\b(снег|лава|пустыня|пустыню|кристаллы|болото|джунгли)\b/.test(t) &&
      /\b(сделай|создай|хочу|генерируй|покажи|дай|хочется)\b/.test(t)) return true;
  return false;
}

function isBuildRequest(prompt: string): boolean {
  const t = prompt.toLowerCase();
  // \w в JS не включает кириллицу, поэтому используем [а-я]* для окончаний
  const hasBuildVerb = /(построй|построить|постройте|возведи|сооруди|строй|создай|сделай|хочу)/.test(t);
  const hasBuildObject = /(замок|замка|замку|дом|дома|башн|башню|башни|крепост|форт|стен|стену|здание|здания|постройк|строени)/.test(t);
  const hasMaterial = /(камн|камен|из\s+камн|стекл|лед|льд|бетон|доск|кристалл|мифич|вулкан|дерев)/.test(t);
  return (hasBuildVerb && (hasBuildObject || hasMaterial))
    || /(построй|возведи|сооруди|сделай)\s+(замок|дом|башн|крепост|форт|стен|здание)/.test(t);
}

function isPatchTilesRequest(prompt: string): boolean {
  const t = prompt.toLowerCase();
  if (/замен[ии]\s+(всю|все|весь|всех|всё|каждый|каждую)\s+\w/.test(t)) return true;
  if (/(везде|повсюду|по\s+всей\s+карте|на\s+всей\s+карте)/.test(t) && /замен|поменя/.test(t)) return true;
  if (/замен[ии]\s+\w+\s+на\s+\w+/.test(t) && !/(север|юг|запад|восток|центр|угол|половин|треть|часть|область|зон|район)/.test(t)) return true;
  return false;
}

function isAreaRequest(prompt: string): boolean {
  const t = prompt.toLowerCase();
  return /(север|юг|запад|восток|центр|угол|половин|треть|четверть|часть|область|зон|район|верх|низ|лев|прав)/.test(t)
    && /(добав|замен|засып|залей|покрой|сделай|измен|постав|создай)/.test(t);
}

export async function POST(req: Request) {
  try {
    const { prompt, playerX, playerY, isPlaceCommand, seed } = await req.json();
    if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY не задан в .env");

    const px = playerX ?? 32;
    const py = playerY ?? 32;
    const mapSeed = seed ?? Math.floor(Math.random() * 999999);

    const looksLikeMapGen  = isMapGenRequest(prompt);
    const looksLikeBuild   = !looksLikeMapGen && isBuildRequest(prompt);
    const looksLikePatch   = !looksLikeMapGen && !looksLikeBuild && isPatchTilesRequest(prompt);
    const looksLikeArea    = !looksLikeMapGen && !looksLikeBuild && !looksLikePatch && isAreaRequest(prompt);

    const userMsg = `Player position: tile x=${px}, y=${py} on 64×64 map.
Player says: "${prompt}"

${isPlaceCommand
  ? '→ PLACE command near player. Use "place_objects".'
  : looksLikeMapGen
  ? '→ NEW WORLD/BIOME requested. Use "generate_map". Pick the correct biome. Return ONLY {"command":"generate_map","biome":"...","description":"..."} — NO map array!'
  : looksLikeBuild
  ? '→ BUILD command. Use "build". Pick type and material from context.'
  : looksLikePatch
  ? '→ REPLACE ALL TILES of one type. Use "patch_tiles" with from/to tile characters.'
  : looksLikeArea
  ? '→ AREA CHANGE requested. Use "modify_area". Generate ALL tile coordinates for the described zone (fill the entire area, not just borders). Up to 800 changes.'
  : '→ Analyze intent carefully and pick the right command. When in doubt about biome/terrain — use generate_map.'}

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
        temperature: 0.3,
        max_tokens: (looksLikeMapGen || looksLikePatch || looksLikeBuild) ? 200 : 4000,
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

    // ── generate_map: карту генерируем на сервере ──────────────────
    if (data.command === "generate_map" || (!data.command && data.biome)) {
      data.command = "generate_map";
      const validBiomes: BiomeKey[] = ["default","snow","lava","desert","mythic","forest","swamp","city"];
      const biome: BiomeKey = validBiomes.includes(data.biome) ? data.biome : "default";
      data.biome = biome;
      data.map = generateIslandMap(biome, mapSeed);
    }

    // ── Если clarify на биомный запрос — принудительно конвертируем ──
    if (data.command === "clarify" && looksLikeMapGen) {
      const t = prompt.toLowerCase();
      const biome: BiomeKey =
        /(снежн|ледян|зимн|снег|лёд|тундр|арктич|горн)/.test(t) ? "snow" :
        /(лавов|вулкан|огненн|магм|лава)/.test(t) ? "lava" :
        /(пустынн|песчан|пустыня|оазис|кактус)/.test(t) ? "desert" :
        /(мифичес|кристалл|магичес|волшебн)/.test(t) ? "mythic" :
        /(болотн|болото|туман|гриб)/.test(t) ? "swamp" :
        /(городск|город|здани|дорог)/.test(t) ? "city" :
        /(лесн|джунгл|чащ|роща|тропичес|дерев)/.test(t) ? "forest" :
        "default";
      data.command = "generate_map";
      data.biome = biome;
      data.description = data.question ?? `Генерирую мир: ${biome}`;
      delete data.question;
      delete data.examples;
      data.map = generateIslandMap(biome, mapSeed);
    }

    // ── Если clarify на build запрос — принудительно конвертируем ──
    if (data.command === "clarify" && looksLikeBuild) {
      const t = prompt.toLowerCase();
      const btype =
        /(замок|castle|крепост|fort)/.test(t) ? "castle" :
        /(башн|tower)/.test(t) ? "tower" :
        /(стен|wall)/.test(t) ? "wall" :
        /(форт|fort)/.test(t) ? "fort" :
        "house";
      data.command = "build";
      data.type = btype;
      data.material = "rock";
      const defaults: Record<string, [number, number]> = {
        castle: [9,7], house: [5,5], tower: [3,8], wall: [12,2], fort: [11,9]
      };
      const [dw, dh] = defaults[btype] ?? [5,5];
      data.width = dw;
      data.height = dh;
      data.description = data.question ?? `Строю ${btype}`;
      delete data.question;
      delete data.examples;
    }

    // ── patch_tiles: валидируем from/to ────────────────────────────
    if (data.command === "patch_tiles") {
      data.from = (data.from ?? "G").slice(0, 1);
      data.to   = (data.to   ?? "S").slice(0, 1);
    }

    // ── Нормализуем map строки ─────────────────────────────────────
    if (data.command === "generate_map" && Array.isArray(data.map) && typeof data.map[0] === "string") {
      const map: string[] = [];
      for (let y = 0; y < MAP_H; y++) {
        const row: string = data.map[y] ?? "";
        map.push(row.padEnd(MAP_W, "G").slice(0, MAP_W));
      }
      data.map = map;
    }

    // ── build: валидируем и нормализуем ───────────────────────────
    if (data.command === "build") {
      const validMaterials = ["rock","glass","ice","concrete","board","mythic_rock","crystal","volcanic_rock"];
      const validTypes = ["castle","house","tower","wall","fort"];

      data.material = data.material ?? data.tile ?? "rock";
      if (!validMaterials.includes(data.material)) data.material = "rock";

      data.type = data.type ?? "house";
      if (!validTypes.includes(data.type)) {
        const t = String(data.type).toLowerCase();
        data.type = t.includes("castle") || t.includes("замок") || t.includes("крепост") ? "castle"
          : t.includes("tower") || t.includes("башн") ? "tower"
          : t.includes("wall") || t.includes("стен") ? "wall"
          : t.includes("fort") || t.includes("форт") ? "fort"
          : "house";
      }

      const defaults: Record<string, [number, number]> = {
        castle: [9,7], house: [5,5], tower: [3,8], wall: [12,2], fort: [11,9]
      };
      const [dw, dh] = defaults[data.type] ?? [5,5];
      data.width  = Math.min(Math.max(parseInt(data.width)  || dw, 2), 30);
      data.height = Math.min(Math.max(parseInt(data.height) || dh, 2), 30);
    }

    // ── set_time ──────────────────────────────────────────────────
    if (data.command === "set_time") {
      const valid = ["day","night","dusk","dawn"];
      if (!valid.includes(data.value)) data.value = "day";
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