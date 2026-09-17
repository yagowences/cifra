import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ThemeToggle } from "@/components/theme-toggle";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const { erro } = await searchParams;

  return (
    <main className="flex min-h-dvh flex-col bg-surface-base">
      <div className="flex justify-end p-2">
        <ThemeToggle initial={theme} />
      </div>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 pb-16">
        <h1 className="text-display-xl">Cifra</h1>
        <p className="mt-2 text-body text-ink-secondary">
          Importe extratos e comprovantes. O Cifra organiza o resto.
        </p>
        <SignInForm linkError={erro === "link"} />
      </div>
    </main>
  );
}
