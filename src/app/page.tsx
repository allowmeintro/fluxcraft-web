'use client';

import Link from "next/link";
import { Play, Award, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center text-white relative overflow-hidden">
      {/* Фон */}
      <div className="absolute inset-0 bg-[radial-gradient(#4a2c0f_0.8px,transparent_1px)] bg-[length:20px_20px] opacity-30"></div>

      <div className="relative z-10 text-center px-6 max-w-3xl">
        <div className="flex justify-center mb-6">
          <div className="flex items-center gap-4 text-7xl">
            🧱 <span className="font-black tracking-tighter">FLUXCRAFT</span>
          </div>
        </div>

        <p className="text-2xl text-orange-400 mb-4">2D SANDBOX</p>
        <p className="text-xl text-zinc-400 mb-12">
          Создавай миры • Ломай и строй • ИИ меняет ландшафт по твоему слову
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/game">
            <Button size="lg" className="bg-orange-600 hover:bg-orange-500 text-xl px-12 py-7 font-bold border-4 border-white">
              <Play className="mr-3 w-7 h-7" />
              ИГРАТЬ СЕЙЧАС
            </Button>
          </Link>

          <Link href="/gallery">
            <Button size="lg" variant="outline" className="border-4 border-white text-xl px-10 py-7 font-bold hover:bg-white hover:text-black">
              <Award className="mr-3" />
              МОИ МИРЫ
            </Button>
          </Link>
        </div>

        <div className="mt-16 text-sm text-zinc-500 flex items-center justify-center gap-8">
          <div>Phaser 3 + Flux</div>
          <div>Next.js 15 + Prisma</div>
          <div>Дипломная работа</div>
        </div>
      </div>
    </div>
  );
}