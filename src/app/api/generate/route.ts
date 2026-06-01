import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const input = await req.json();
    let prompt = input.prompt || "beautiful epic pixel art landscape";
    
    // Проверяем, содержит ли промпт кириллицу (русские символы)
    const hasCyrillic = /[а-яА-ЯёЁ]/.test(prompt);
    
    // Если промпт на русском, добавляем английские ключевые слова для Pollinations
    if (hasCyrillic) {
      // Добавляем базовые английские слова для лучшего понимания
      prompt = prompt + ", landscape, game art, digital painting, high quality, detailed";
      console.log("Промпт содержит кириллицу, добавлены английские ключевые слова");
    }
    
    // Кодируем промпт для безопасной передачи в URL
    const encodedPrompt = encodeURIComponent(prompt);
    
    // Генерируем прямую ссылку на картинку (Pollinations отдает её мгновенно)
    // Используем seed для консистентности и добавляем параметры
    const seed = Math.floor(Math.random() * 1000000);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=576&seed=${seed}&nologo=true&model=flux`;

    console.log("Генерация успешна, ссылка:", imageUrl);

    return NextResponse.json({ imageUrl });
  } catch (error: any) {
    console.error("Ошибка API генерации:", error);
    return NextResponse.json({ 
      error: "Внутренняя ошибка сервера", 
      message: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}
