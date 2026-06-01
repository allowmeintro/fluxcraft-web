import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";
import bcrypt from "bcryptjs";
 
import { prisma } from "@/lib/prisma";
 
const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
 
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        console.log("[NextAuth] Начинаю авторизацию. Raw credentials:", raw);

        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          console.log("[NextAuth] Ошибка валидации данных:", parsed.error.format());
          return null;
        }

        console.log("[NextAuth] Поиск юзера:", parsed.data.email);
        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });

        if (!user) {
          console.log("[NextAuth] Юзер не найден в БД:", parsed.data.email);
          return null;
        }

        if (!user?.passwordHash) {
          console.log("[NextAuth] У юзера нет passwordHash (возможно, регистрация через Google):", parsed.data.email);
          return null;
        }

        console.log("[NextAuth] Юзер найден, проверяю пароль...");
        try {
          const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
          console.log("[NextAuth] Результат проверки пароля:", ok ? "УСПЕХ" : "НЕВЕРНЫЙ ПАРОЛЬ");
          if (!ok) return null;
        } catch (error) {
          console.log("[NextAuth] Ошибка проверки пароля:", error);
          return null;
        }

        console.log("[NextAuth] Авторизация успешна для:", parsed.data.email);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    // Сохраняем id пользователя в JWT токен
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    // Берём id из токена (при JWT стратегии user = undefined!)
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});