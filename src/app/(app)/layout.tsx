import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Gamepad2, LogOut, Sparkles } from "lucide-react";

import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen bg-zinc-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-orange-950/20">
      <header className="sticky top-0 z-40 border-b border-orange-500/20 bg-zinc-900/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/15 text-orange-400">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <div className="font-semibold text-zinc-100">FluxCraft</div>
              <div className="text-xs text-orange-400/70">AI Game Landscapes</div>
            </div>
          </Link>

          <nav className="hidden items-center gap-2 md:flex">
            <Link href="/game">
              <Button variant="ghost" className="text-zinc-300 hover:text-orange-400 hover:bg-orange-500/10">
                <Gamepad2 className="mr-1 h-4 w-4" />
                Игра
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="ghost" className="text-zinc-300 hover:text-orange-400 hover:bg-orange-500/10">
                Генератор
              </Button>
            </Link>
            <Link href="/gallery">
              <Button variant="ghost" className="text-zinc-300 hover:text-orange-400 hover:bg-orange-500/10">
                Галерея
              </Button>
            </Link>
            <Link href="/profile">
              <Button variant="ghost" className="text-zinc-300 hover:text-orange-400 hover:bg-orange-500/10">
                Профиль
              </Button>
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-orange-500/20 text-orange-400 border-orange-500/30 hidden sm:inline-flex">
              {session.user.email ?? "User"}
            </Badge>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button type="submit" variant="outline" size="icon" aria-label="Выйти" className="border-orange-500/20 text-zinc-300 hover:text-orange-400 hover:bg-orange-500/10">
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}