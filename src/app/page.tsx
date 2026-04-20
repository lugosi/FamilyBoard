import { Suspense } from "react";
import { Board } from "@/components/Board";

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-300">
          Loading board…
        </div>
      }
    >
      <Board />
    </Suspense>
  );
}
