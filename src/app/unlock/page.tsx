import { Suspense } from "react";
import { UnlockForm } from "./UnlockForm";

export default function UnlockPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-300">
          Loading…
        </div>
      }
    >
      <UnlockForm />
    </Suspense>
  );
}
