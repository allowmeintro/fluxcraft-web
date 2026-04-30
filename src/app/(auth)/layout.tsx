import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[calc(100vh)] flex items-center justify-center px-4 py-10">
      {children}
    </div>
  );
}

