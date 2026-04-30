import Image from "next/image";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Галерея",
  description: "Ваши сгенерированные изображения (сохранены в базе данных).",
};

export default async function GalleryPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const generations = await prisma.generation.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      imageUrl: true,
      prompt: true,
      genre: true,
      aspectRatio: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Галерея</h1>
        <p className="text-muted-foreground">Все ваши генерации, сохранённые в Prisma/SQLite.</p>
      </div>

      {generations.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Пока пусто</CardTitle>
            <CardDescription>Сгенерируйте первый пейзаж в Dashboard — и он появится здесь.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {generations.map((g) => (
            <Card key={g.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="relative aspect-[16/9] w-full bg-muted/30">
                  {g.imageUrl ? (
                    <Image
                      src={g.imageUrl}
                      alt={g.prompt}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : null}
                </div>
                <div className="space-y-2 p-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{g.genre}</Badge>
                    <Badge variant="outline">{g.aspectRatio}</Badge>
                  </div>
                  <p className="line-clamp-3 text-sm text-muted-foreground">{g.prompt}</p>
                  {g.imageUrl ? (
                    <a
                      className="text-sm text-primary hover:underline"
                      href={g.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Открыть оригинал
                    </a>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

