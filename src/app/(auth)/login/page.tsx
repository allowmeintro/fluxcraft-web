'use client';
 
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
 
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
        // Вход через NextAuth
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
 
        // Ждём чтобы JWT куки успели установиться
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
    // Устанавливаем куки для демо-режима (чтобы middleware пропускал к защищенным страницам)
    document.cookie = "demoLoggedIn=true; path=/; max-age=86400"; // 24 часа
    
    toast.success("✅ Демо-вход выполнен!", {
      description: "Добро пожаловать в FluxCraft. Вы в демо-режиме.",
    });

    // Переходим в игру
    window.location.href = "/game";
  };
 
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-zinc-900 border-zinc-800">
        <CardHeader className="text-center">
          <CardTitle className="text-4xl font-black tracking-tighter">FLUXCRAFT</CardTitle>
          <CardDescription className="text-orange-400 mt-2">2D Sandbox с ИИ</CardDescription>
        </CardHeader>
 
        <CardContent className="space-y-6 pt-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div className="space-y-2">
                <Label htmlFor="name" className="text-zinc-300">Имя</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="Введите ваше имя"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                  className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-orange-500 focus:ring-orange-500"
                />
              </div>
            )}
 
            <div className="space-y-2">
              <Label htmlFor="email" className="text-zinc-300">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="Введите ваш email"
                value={formData.email}
                onChange={handleInputChange}
                required
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-orange-500 focus:ring-orange-500"
              />
            </div>
 
            <div className="space-y-2">
              <Label htmlFor="password" className="text-zinc-300">Пароль</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="Введите ваш пароль"
                value={formData.password}
                onChange={handleInputChange}
                required
                minLength={6}
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-orange-500 focus:ring-orange-500"
              />
            </div>
 
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full py-6 text-lg font-bold bg-orange-600 hover:bg-orange-500"
            >
              {isLoading ? "Загрузка..." : mode === "login" ? "🔐 Войти" : "📝 Зарегистрироваться"}
            </Button>
          </form>
 
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-zinc-700" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-zinc-900 px-2 text-zinc-500">или</span>
            </div>
          </div>
 
          <Button
            onClick={handleDemoLogin}
            disabled={isLoading}
            variant="outline"
            className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
          >
            🎮 Демо-вход (без регистрации)
          </Button>
 
          <p className="text-center text-sm text-zinc-500">
            {mode === "login" ? (
              <>
                Нет аккаунта?{" "}
                <button
                  type="button"
                  onClick={() => setMode("register")}
                  className="text-orange-400 hover:text-white underline cursor-pointer"
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
                  className="text-orange-400 hover:text-white underline cursor-pointer"
                >
                  Войти
                </button>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}