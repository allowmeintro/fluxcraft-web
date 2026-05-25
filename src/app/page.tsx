'use client';

import { useEffect, useState } from "react";
import Link from "next/link";
import { Compass, Trophy, Award, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, Variants } from "framer-motion";

export default function Home() {
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; size: number; duration: number; delay: number; rotation: number; drift: number }[]>([]);

  useEffect(() => {
    const newParticles = Array.from({ length: 60 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 6 + 2,
      duration: Math.random() * 20 + 15,
      delay: Math.random() * -40,
      rotation: Math.random() * 360,
      drift: (Math.random() - 0.5) * 40,
    }));
    setParticles(newParticles);
  }, []);

  const container: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.18, delayChildren: 0.3 } }
  };

  const item: Variants = {
    hidden: { opacity: 0, y: 50, scale: 0.95 },
    show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.8, type: "spring", bounce: 0.45 } }
  };

  const glowPulse = {
    animate: {
      boxShadow: [
        "0 0 20px rgba(234,88,12,0.3)",
        "0 0 40px rgba(234,88,12,0.6)",
        "0 0 20px rgba(234,88,12,0.3)",
      ],
      transition: { duration: 2.5, repeat: Infinity, ease: "easeInOut" as const }
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center text-white relative overflow-hidden">
      {/* Пульсирующий радиальный градиент */}
      <motion.div 
        className="absolute inset-0 z-0"
        animate={{ 
          background: [
            "radial-gradient(ellipse at 50% 50%, rgba(234,88,12,0.08) 0%, transparent 60%)",
            "radial-gradient(ellipse at 50% 50%, rgba(234,88,12,0.15) 0%, transparent 60%)",
            "radial-gradient(ellipse at 50% 50%, rgba(234,88,12,0.08) 0%, transparent 60%)",
          ]
        }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Сетка в стиле Tron */}
      <div className="absolute inset-0 bg-[radial-gradient(#4a2c0f_0.8px,transparent_1px)] bg-[length:20px_20px] opacity-30 z-0"></div>
      
      {/* Горизонтальные линии по краям */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-orange-500/30 to-transparent z-10" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-orange-500/30 to-transparent z-10" />

      {/* Падающие искры */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        {particles.map((p) => (
          <motion.div
            key={p.id}
            className="absolute bg-orange-500 rounded-full"
            style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size }}
            animate={{ 
              y: ["0vh", "105vh"], 
              x: [0, p.drift, -p.drift * 0.5, p.drift],
              rotate: [p.rotation, p.rotation + 720], 
              opacity: [0, 0.8, 0.6, 0],
              scale: [0, 1.2, 0.8, 0],
            }}
            transition={{ duration: p.duration, repeat: Infinity, delay: p.delay, ease: "linear" }}
          />
        ))}
      </div>

      <motion.div variants={container} initial="hidden" animate="show" className="relative z-10 text-center px-6 max-w-4xl">

        {/* ЛОГОТИП с сиянием */}
        <motion.div 
          variants={item}
          className="flex justify-center mb-4"
          whileHover={{ scale: 1.02 }}
        >
          <motion.div 
            className="flex items-center gap-4 text-7xl relative"
            animate={{ textShadow: ["0 0 20px rgba(234,88,12,0.3)", "0 0 40px rgba(234,88,12,0.7)", "0 0 20px rgba(234,88,12,0.3)"] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <motion.span
              animate={{ rotate: [0, -5, 5, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              🧱
            </motion.span>
            <span className="font-black tracking-tighter bg-gradient-to-r from-orange-400 via-orange-300 to-yellow-200 bg-clip-text text-transparent drop-shadow-[0_0_15px_rgba(234,88,12,0.5)]">
              FLUXCRAFT
            </span>
          </motion.div>
        </motion.div>

        <motion.p 
          variants={item} 
          className="text-2xl text-orange-400/80 mb-3 tracking-[0.3em] uppercase font-light"
        >
          2D SANDBOX
        </motion.p>
        
        <motion.p 
          variants={item} 
          className="text-lg text-zinc-500 mb-10 max-w-xl mx-auto leading-relaxed"
        >
          <span className="text-orange-300/60">✦</span> Создавай миры  <span className="text-orange-300/60">✦</span> Ломай и строй  <span className="text-orange-300/60">✦</span> ИИ меняет ландшафт
        </motion.p>

        {/* КНОПКИ ВЫБОРА РЕЖИМА — премиум */}
        <motion.div variants={item} className="flex flex-col sm:flex-row gap-5 justify-center mt-6">
          
          {/* "Свободная игра" */}
          <Link href="/game?mode=free" className="group">
            <motion.div
              whileHover={{ scale: 1.05, y: -4 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <Button 
                size="lg" 
                className="w-full sm:w-64 bg-zinc-900/90 backdrop-blur-sm hover:bg-zinc-800 text-lg px-8 py-8 font-bold border border-zinc-700/50 hover:border-orange-500/40 shadow-lg hover:shadow-orange-500/10 transition-all duration-300 relative overflow-hidden group"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <Compass className="mr-3 w-6 h-6 text-zinc-400 group-hover:text-orange-400 transition-colors duration-300" />
                <div className="text-left relative z-10">
                  <div className="text-white font-bold group-hover:text-orange-100 transition-colors">СВОБОДНАЯ ИГРА</div>
                  <div className="text-[10px] text-zinc-500 font-normal leading-tight mt-1 flex items-center gap-1">
                    <Zap className="w-3 h-3 text-orange-500/50" /> Твори без ограничений
                  </div>
                </div>
              </Button>
            </motion.div>
          </Link>

          {/* "История / Квесты" */}
          <Link href="/game?mode=quest" className="group">
            <motion.div
              whileHover={{ scale: 1.05, y: -4 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 300 }}
              animate={glowPulse.animate}
            >
              <Button 
                size="lg" 
                className="w-full sm:w-64 bg-gradient-to-b from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 text-lg px-8 py-8 font-bold border border-orange-400/30 shadow-[0_0_20px_rgba(234,88,12,0.3)] hover:shadow-[0_0_35px_rgba(234,88,12,0.5)] transition-all duration-300 relative overflow-hidden group"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-yellow-300/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <Trophy className="mr-3 w-6 h-6 text-yellow-300 group-hover:text-yellow-200 transition-colors" />
                <div className="text-left relative z-10">
                  <div className="font-bold">ИСТОРИЯ / КВЕСТЫ</div>
                  <div className="text-[10px] text-orange-200 font-normal leading-tight mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Пройди обучение с ИИ
                  </div>
                </div>
              </Button>
            </motion.div>
          </Link>
        </motion.div>

        {/* Кнопка "Галерея миров" */}
        <motion.div variants={item} className="mt-8 flex justify-center">
          <Link href="/gallery">
            <motion.div
              whileHover={{ scale: 1.04, y: -2 }}
              whileTap={{ scale: 0.98 }}
            >
              <Button 
                variant="outline" 
                className="border border-zinc-800 text-zinc-500 px-6 py-5 hover:bg-zinc-900/80 hover:text-orange-400 hover:border-orange-500/30 transition-all duration-300 group"
              >
                <Award className="mr-2 w-4 h-4 group-hover:text-orange-400 transition-colors" />
                <span className="tracking-wider text-xs">ГАЛЕРЕЯ МИРОВ</span>
              </Button>
            </motion.div>
          </Link>
        </motion.div>

        {/* Нижний футер */}
        <motion.div 
          variants={item} 
          className="mt-16 text-xs text-zinc-700 flex items-center justify-center gap-6"
        >
          <span className="hover:text-zinc-500 transition-colors cursor-default">⚡ Phaser 3 + Flux</span>
          <span className="w-1 h-1 rounded-full bg-zinc-700" />
          <span className="hover:text-zinc-500 transition-colors cursor-default">🛠️ Next.js 15 + Prisma</span>
          <span className="w-1 h-1 rounded-full bg-zinc-700" />
          <span className="hover:text-orange-500/50 transition-colors cursor-default">🎓 Дипломная работа</span>
        </motion.div>
      </motion.div>
    </div>
  );
}