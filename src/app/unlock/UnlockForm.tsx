"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function UnlockForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nextPath = useMemo(() => {
    const value = searchParams.get("next");
    if (!value || !value.startsWith("/")) {
      return "/";
    }
    return value;
  }, [searchParams]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setError(data?.error ?? "Could not unlock board.");
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-4 text-slate-100">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/90 p-6 shadow-xl"
      >
        <h1 className="text-xl font-semibold tracking-tight">Unlock Family Board</h1>
        <p className="mt-2 text-sm text-slate-300">
          Enter your access code to continue.
        </p>
        <label className="mt-5 block text-sm font-medium text-slate-200" htmlFor="code">
          Access code
        </label>
        <input
          id="code"
          type="password"
          autoComplete="current-password"
          spellCheck={false}
          className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-cyan-500 transition focus:ring-2"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
        />
        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-5 w-full rounded-lg bg-cyan-600 px-4 py-2 font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Unlocking..." : "Unlock"}
        </button>
      </form>
    </main>
  );
}
