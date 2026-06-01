import { auth } from "@/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Профиль",
  description: "Статистика игрока в мире FluxCraft.",
};

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Профиль</h1>
        <p className="text-muted-foreground">Статистика игрока в мире FluxCraft.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Статистика</CardTitle>
            <CardDescription>Сводная информация по аккаунту.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Email</span>
              <Badge variant="secondary">{session.user?.email ?? "—"}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Исследовано биомов</span>
              <Badge>7</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Создано объектов</span>
              <Badge>∞</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Команды мира FluxCraft</CardTitle>
            <CardDescription>Запроси у ИИ любую команду в игре.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-2">
              <li className="rounded-lg border bg-muted/20 p-3">
                <Badge variant="outline">🗺️ Биомы</Badge>
                <p className="mt-2 text-sm text-muted-foreground">
                  «снежный лес», «вулканический мир», «пустыня с оазисом», «мифический лес»
                </p>
              </li>
              <li className="rounded-lg border bg-muted/20 p-3">
                <Badge variant="outline">🏗️ Постройки</Badge>
                <p className="mt-2 text-sm text-muted-foreground">
                  «построй замок 5 на 3 из стекла», «башня 3 на 5», «дом из бетона 4 на 4»
                </p>
              </li>
              <li className="rounded-lg border bg-muted/20 p-3">
                <Badge variant="outline">🌙 Время</Badge>
                <p className="mt-2 text-sm text-muted-foreground">
                  «сделай ночь», «закат», «рассвет»
                </p>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}