import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Биомы FluxCraft",
  description: "Энциклопедия доступных биомов в мире FluxCraft.",
};

const biomes = [
  {
    name: "Снежный",
    icon: "❄️",
    emoji: "🧊",
    color: "from-blue-500 to-cyan-300",
    desc: "Заснеженная тундра с ледяными озёрами, соснами и снежными камнями. Идеально для ледяных замков и морозных приключений.",
    ai: "Напиши в чат: «Снежный лес с ледяным озером»",
  },
  {
    name: "Вулканический",
    icon: "🌋",
    emoji: "🔥",
    color: "from-red-700 to-orange-500",
    desc: "Раскалённая лава, вулканический камень и угольные деревья. Огненный ландшафт с магмовыми реками и обугленными руинами.",
    ai: "Напиши в чат: «Лавовый мир с реками огня»",
  },
  {
    name: "Пустыня",
    icon: "🏜️",
    emoji: "☀️",
    color: "from-yellow-600 to-amber-400",
    desc: "Жёлтые пески, кактусы, песчаные камни и оазисы. Жаркий биом с руинами древней цивилизации.",
    ai: "Напиши в чат: «Пустыня с оазисом и кактусами»",
  },
  {
    name: "Мифический лес",
    icon: "✨",
    emoji: "💜",
    color: "from-purple-800 to-pink-500",
    desc: "Фиолетовые светящиеся деревья, мифическая трава, кристаллы и волшебные камни. Магический биом с неоновыми грибами.",
    ai: "Напиши в чат: «Мифический лес с кристаллами и грибами»",
  },
  {
    name: "Болото",
    icon: "🌿",
    emoji: "🍄",
    color: "from-green-900 to-emerald-600",
    desc: "Тёмные топи с туманом, мшистой травой, грибами и гнилыми корягами. Мрачный и таинственный биом.",
    ai: "Напиши в чат: «Болото с туманами и грибами»",
  },
  {
    name: "Луг",
    icon: "🌲",
    emoji: "🌳",
    color: "from-green-600 to-lime-500",
    desc: "Зелёные луга с лесами, реками и полянами. Классический стартовый биом для строительства и исследований.",
    ai: "Напиши в чат: «Лесной луг с озером и поляной»",
  },
];

export default function BiomesPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">🌍 Доступные биомы FluxCraft</h1>
        <p className="text-muted-foreground">Энциклопедия биомов — каждый имеет уникальный ландшафт, блоки и атмосферу.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {biomes.map((b) => (
          <Card key={b.name} className="overflow-hidden border-orange-500/20 bg-zinc-900/80">
            <div className={`h-24 bg-gradient-to-br ${b.color} flex items-center justify-center text-5xl`}>
              {b.emoji}
            </div>
            <CardHeader>
              <CardTitle className="text-zinc-100 flex items-center gap-2">
                {b.icon} {b.name}
              </CardTitle>
              <CardDescription>{b.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-xs p-2 whitespace-normal h-auto">
                💡 {b.ai}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}