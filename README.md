# AI Game Landscapes Generator - FluxCraft

## RU — О проекте

**Полное название диплома:** «Разработка веб-приложения для генерации игровых пейзажей с использованием генеративных моделей искусственного интеллекта»

Приложение позволяет пользователю:
- вводить текстовый промпт;
- выбирать жанр, соотношение сторон и параметры сцены;
- генерировать игровые пейзажи с помощью Replicate (Flux);
- сохранять результат в базу данных и просматривать в галерее.

## Стек (для комиссии)

- **Next.js 15+** (App Router, Server Actions, React 19)
- **TypeScript (strict)**
- **Tailwind CSS** + shadcn‑style UI (Radix + CVA) + `clsx`/`tailwind-merge`
- **NextAuth.js v5** (Credentials + Google OAuth) + защищённые маршруты (middleware)
- **Prisma + SQLite** (локальная разработка)
- **Replicate API** (Flux Schnell / Flux Pro)
- **Sonner** (toasts), **Lucide React** (иконки), **Zod** (валидация)

## Быстрый старт (локально)

1) Установить зависимости:

```bash
npm install
```

2) Создать `.env` (можно скопировать из `.env.example`):

```bash
copy .env.example .env
```

3) Заполнить переменные:
- `DATABASE_URL` (SQLite по умолчанию: `file:./dev.db`)
- `NEXTAUTH_SECRET` (случайная строка)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (для Google OAuth)
- `REPLICATE_API_TOKEN`

4) Сгенерировать Prisma Client и синхронизировать БД:

```bash
npx prisma generate
npx prisma db push
```

5) Запуск:

```bash
npm run dev
```

Откройте `http://localhost:3000`.

## Маршруты

- `/` — лендинг
- `/login`, `/register` — авторизация
- `/dashboard` — генератор (Server Action → Replicate → сохранение в Prisma)
- `/gallery` — галерея пользователя
- `/profile` — статистика и история промптов

## Docker (для демонстрации)

```bash
docker compose up --build
```

Перед запуском добавьте переменные `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `REPLICATE_API_TOKEN` в окружение (или в `.env`).

## Prisma 7 примечание

В Prisma ORM v7 строка подключения переносится в `prisma.config.ts` (поэтому в `schema.prisma` нет `url = env(...)`).

## Как перейти на PostgreSQL / Supabase

- Замените `provider = "sqlite"` на `provider = "postgresql"` в `prisma/schema.prisma`.
- Обновите `DATABASE_URL` на строку подключения PostgreSQL.
- Запустите миграции (для продакшена предпочтительнее `prisma migrate`).

## Как это поможет на защите диплома (готовый текст)

Это приложение демонстрирует:
- **Full‑stack разработку**: UI (Next.js) + серверная логика (Server Actions/API) + БД (Prisma).
- **Современную AI‑интеграцию**: генерация ассетов через diffusion‑модели (Flux) с параметризацией под геймдев.
- **Безопасность и продакшн‑подход**: авторизация (NextAuth), middleware, валидация (Zod), обработка ошибок.
- **Практическую ценность**: быстрый выпуск концепт‑арта и игровых фонов/окружений в нужных форматах (16:9, 21:9, 9:16, 1:1), с сохранением истории и галереи.

## EN — Overview

AI Game Landscapes Generator is a production‑ready Next.js app that generates game landscape images from text prompts using Replicate (Flux) and stores results per user using Prisma.
