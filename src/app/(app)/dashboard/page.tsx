import { GeneratorForm } from "./generator-form";

export const metadata = {
  title: "Dashboard",
  description: "Генератор игровых пейзажей на базе Flux (Replicate).",
};

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">FluxCraft Generator</h1>
        <p className="text-zinc-400">
          Создавайте игровые пейзажи для backgrounds, environments и concept art — быстро и воспроизводимо.
        </p>
      </div>
      <GeneratorForm />
    </div>
  );
}