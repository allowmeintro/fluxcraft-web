"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { signIn } from "@/auth";

const registerSchema = z.object({
  name: z.string().trim().min(2).max(60),
  email: z.string().email(),
  password: z.string().min(6).max(200),
});

export async function registerWithCredentials(formData: FormData) {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };

  const callbackUrl = String(formData.get("callbackUrl") ?? "/dashboard");

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    // Для диплома: простая, но безопасная обработка (не раскрываем детали в UI).
    redirect(`/register?callbackUrl=${encodeURIComponent(callbackUrl)}&error=validation`);
  }

  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) redirect(`/register?callbackUrl=${encodeURIComponent(callbackUrl)}&error=exists`);

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
    },
  });

  await signIn("credentials", {
    email: parsed.data.email,
    password: parsed.data.password,
    redirectTo: callbackUrl,
  });
}

