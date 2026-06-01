import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Gamepad2, LogOut, Sparkles, LayoutGrid, User } from "lucide-react";
import { cookies } from "next/headers";

import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const isDemoLoggedIn = (await cookies()).get("demoLoggedIn")?.value === "true";
  if (!session?.user && !isDemoLoggedIn) redirect("/login");

  const userEmail = session?.user?.email ?? "Demo";

  return (
    <div className="min-h-screen bg-zinc-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-orange-950/20">
      
      {/* ─── ШАПКА: полупрозрачная, фиксированная, с анимацией въезда ─── */}
      <header 
        className="sticky top-0 z-50 border-b border-orange-500/20 bg-zinc-950/70 backdrop-blur-xl 
                   animate-in slide-in-from-top duration-500 ease-out shadow-[0_4px_30px_rgba(0,0,0,0.3)]"
      >
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-2.5">

          {/* ── Логотип FluxCraft с неоновым свечением ── */}
          <Link 
            href="/dashboard" 
            className="flex items-center gap-2 group transition-all duration-300 hover:scale-105"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/15 text-orange-400 
                            group-hover:bg-orange-500/25 group-hover:shadow-[0_0_15px_rgba(234,88,12,0.4)] transition-all duration-300">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <div className="font-semibold text-zinc-100 
                              group-hover:text-orange-200 group-hover:[text-shadow:0_0_10px_rgba(234,88,12,0.5)] 
                              transition-all duration-300">
                FluxCraft
              </div>
              <div className="text-xs text-orange-400/70 group-hover:text-orange-400 transition-colors duration-300">
                AI Game Landscapes
              </div>
            </div>
          </Link>

          {/* ── Навигация с оранжевым подчеркиванием ── */}
          <nav className="hidden items-center gap-1 md:flex">
            <Link href="/game">
              <Button 
                variant="ghost" 
                className="relative text-zinc-400 hover:text-orange-400 hover:bg-orange-500/10 transition-all duration-300 
                           after:absolute after:bottom-0.5 after:left-2 after:right-2 after:h-[2px] 
                           after:bg-orange-400 after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-300"
              >
                <Gamepad2 className="mr-1.5 h-4 w-4" />
                Игра
              </Button>
            </Link>
            <Link href="/gallery">
              <Button 
                variant="ghost" 
                className="relative text-zinc-400 hover:text-orange-400 hover:bg-orange-500/10 transition-all duration-300
                           after:absolute after:bottom-0.5 after:left-2 after:right-2 after:h-[2px] 
                           after:bg-orange-400 after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-300"
              >
                <LayoutGrid className="mr-1.5 h-4 w-4" />
                Биомы
              </Button>
            </Link>
            <Link href="/profile">
              <Button 
                variant="ghost" 
                className="relative text-zinc-400 hover:text-orange-400 hover:bg-orange-500/10 transition-all duration-300
                           after:absolute after:bottom-0.5 after:left-2 after:right-2 after:h-[2px] 
                           after:bg-orange-400 after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-300"
              >
                <User className="mr-1.5 h-4 w-4" />
                Профиль
              </Button>
            </Link>
          </nav>

          {/* ── Профиль и Выход ── */}
          <div className="flex items-center gap-3">
            <Badge 
              variant="secondary" 
              className="hidden sm:inline-flex bg-zinc-900/80 border border-zinc-700/60 text-zinc-300 
                         hover:border-orange-500/50 hover:text-orange-300 hover:shadow-[0_0_10px_rgba(234,88,12,0.15)]
                         transition-all duration-300 rounded-full px-4 py-2 text-xs font-medium"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 animate-pulse" />
              {userEmail}
            </Badge>

            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button 
                type="submit" 
                variant="outline" 
                size="icon" 
                aria-label="Выйти" 
                className="border-orange-500/20 text-zinc-400 hover:text-orange-400 hover:bg-orange-500/10 
                           hover:border-orange-500/40 transition-all duration-300 group"
              >
                <LogOut className="h-4 w-4 group-hover:translate-x-0.5 transition-transform duration-300" />
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}