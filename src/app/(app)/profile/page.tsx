import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Профиль",
  description: "История генераций и статистика пользователя.",
};

export default async function ProfilePage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const [count, latest] = await Promise.all([
    prisma.generation.count({ where: { userId } }),
    prisma.generation.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        prompt: true,
        genre: true,
        createdAt: true,
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Профиль</h1>
        <p className="text-muted-foreground">Статистика и история ваших генераций.</p>
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
              <span className="text-sm text-muted-foreground">Создано изображений</span>
              <Badge>{count}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Последние промпты</CardTitle>
            <CardDescription>Можно копировать и повторно использовать.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {latest.length === 0 ? (
              <p className="text-sm text-muted-foreground">Пока нет генераций.</p>
            ) : (
              <ul className="space-y-2">
                {latest.map((g) => (
                  <li key={g.id} className="rounded-lg border bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant="outline">{g.genre}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(g.createdAt).toLocaleString("ru-RU")}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{g.prompt}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

