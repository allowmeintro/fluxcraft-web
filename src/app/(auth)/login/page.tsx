'use client';
 
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { motion, Variants } from "framer-motion";
 
type AuthMode = "login" | "register";
 
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [particles, setParticles] = useState<{
    id: number; x: number; y: number; size: number;
    duration: number; delay: number; rotation: number; drift: number;
  }[]>([]);

  useEffect(() => {
    const newParticles = Array.from({ length: 50 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 5 + 2,
      duration: Math.random() * 18 + 12,
      delay: Math.random() * -30,
      rotation: Math.random() * 360,
      drift: (Math.random() - 0.5) * 35,
    }));
    setParticles(newParticles);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };
 
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
 
    try {
      if (mode === "register") {
        const response = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.name,
            email: formData.email,
            password: formData.password,
          }),
        });
 
        const data = await response.json();
 
        if (!response.ok) {
          throw new Error(data.error || "Ошибка регистрации");
        }
 
        toast.success("✅ Регистрация успешна!", {
          description: "Теперь войдите в систему",
        });
 
        setMode("login");
      } else {
        const result = await signIn("credentials", {
          email: formData.email,
          password: formData.password,
          redirect: false,
        });
 
        if (result?.error) {
          throw new Error("Неверный email или пароль");
        }
 
        toast.success("✅ Вход выполнен!", {
          description: "Добро пожаловать в FluxCraft",
        });
 
        await new Promise((r) => setTimeout(r, 300));
        router.refresh();
        router.push("/game");
      }
    } catch (error) {
      toast.error("❌ Ошибка", {
        description: error instanceof Error ? error.message : "Что-то пошло не так",
      });
    } finally {
      setIsLoading(false);
    }
  };
 
  const handleDemoLogin = async () => {
    await fetch("/api/demo-login", { method: "POST" });
    toast.success("✅ Демо-вход выполнен!", {
      description: "Добро пожаловать в FluxCraft. Вы в демо-режиме.",
    });
    window.location.href = "/game";
  };
 
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 relative overflow-hidden">

      {/* Пульсирующий радиальный градиент */}
      <motion.div
        className="absolute inset-0 z-0"
        animate={{
          background: [
            "radial-gradient(ellipse at 50% 50%, rgba(234,88,12,0.07) 0%, transparent 60%)",
            "radial-gradient(ellipse at 50% 50%, rgba(234,88,12,0.14) 0%, transparent 60%)",
            "radial-gradient(ellipse at 50% 50%, rgba(234,88,12,0.07) 0%, transparent 60%)",
          ],
        }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Сетка в стиле Tron */}
      <div className="absolute inset-0 bg-[radial-gradient(#4a2c0f_0.8px,transparent_1px)] bg-[length:20px_20px] opacity-25 z-0" />

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

      {/* Карточка входа */}
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, type: "spring", bounce: 0.35 }}
        className="relative z-10 w-full max-w-md"
      >
        <Card className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800/60 shadow-[0_0_40px_rgba(234,88,12,0.08)]">

          {/* Верхняя световая полоска */}
          <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-orange-500/40 to-transparent rounded-full" />

          <CardHeader className="text-center pb-2">
            <motion.div
              animate={{
                textShadow: [
                  "0 0 20px rgba(234,88,12,0.3)",
                  "0 0 40px rgba(234,88,12,0.65)",
                  "0 0 20px rgba(234,88,12,0.3)",
                ],
              }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <CardTitle className="text-4xl font-black tracking-tighter bg-gradient-to-r from-orange-400 via-orange-300 to-yellow-200 bg-clip-text text-transparent">
                FLUXCRAFT
              </CardTitle>
            </motion.div>
            <CardDescription className="text-orange-400/80 mt-1 tracking-widest text-xs uppercase">
              2D Sandbox с ИИ
            </CardDescription>
          </CardHeader>
 
          <CardContent className="space-y-5 pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "register" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2"
                >
                  <Label htmlFor="name" className="text-zinc-400 text-xs uppercase tracking-wider">Имя</Label>
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    placeholder="Введите ваше имя"
                    value={formData.name}
                    onChange={handleInputChange}
                    required
                    className="bg-zinc-800/60 border-zinc-700/50 text-white placeholder:text-zinc-600 focus:border-orange-500/70 focus:ring-1 focus:ring-orange-500/30 transition-all"
                  />
                </motion.div>
              )}
 
              <div className="space-y-2">
                <Label htmlFor="email" className="text-zinc-400 text-xs uppercase tracking-wider">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="Введите ваш email"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                  className="bg-zinc-800/60 border-zinc-700/50 text-white placeholder:text-zinc-600 focus:border-orange-500/70 focus:ring-1 focus:ring-orange-500/30 transition-all"
                />
              </div>
 
              <div className="space-y-2">
                <Label htmlFor="password" className="text-zinc-400 text-xs uppercase tracking-wider">Пароль</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Введите ваш пароль"
                  value={formData.password}
                  onChange={handleInputChange}
                  required
                  minLength={6}
                  className="bg-zinc-800/60 border-zinc-700/50 text-white placeholder:text-zinc-600 focus:border-orange-500/70 focus:ring-1 focus:ring-orange-500/30 transition-all"
                />
              </div>
 
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-6 text-base font-bold bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 border border-orange-400/20 shadow-[0_0_20px_rgba(234,88,12,0.25)] hover:shadow-[0_0_35px_rgba(234,88,12,0.45)] transition-all duration-300"
                >
                  {isLoading
                    ? "Загрузка..."
                    : mode === "login"
                    ? "🔐 Войти"
                    : "📝 Зарегистрироваться"}
                </Button>
              </motion.div>
            </form>
 
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-zinc-800" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-zinc-900/80 px-3 text-zinc-600 tracking-widest">или</span>
              </div>
            </div>
 
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button
                onClick={handleDemoLogin}
                disabled={isLoading}
                variant="outline"
                className="w-full border-zinc-700/60 text-zinc-400 hover:bg-zinc-800/60 hover:text-orange-300 hover:border-orange-500/30 transition-all duration-300"
              >
                🎮 Демо-вход (без регистрации)
              </Button>
            </motion.div>
 
            <p className="text-center text-sm text-zinc-600">
              {mode === "login" ? (
                <>
                  Нет аккаунта?{" "}
                  <button
                    type="button"
                    onClick={() => setMode("register")}
                    className="text-orange-500/80 hover:text-orange-300 underline cursor-pointer transition-colors"
                  >
                    Зарегистрироваться
                  </button>
                </>
              ) : (
                <>
                  Уже есть аккаунт?{" "}
                  <button
                    type="button"
                    onClick={() => setMode("login")}
                    className="text-orange-500/80 hover:text-orange-300 underline cursor-pointer transition-colors"
                  >
                    Войти
                  </button>
                </>
              )}
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}