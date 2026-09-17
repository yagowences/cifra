import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/nav/app-sidebar";
import { BottomNav } from "@/components/nav/bottom-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { getCurrentUser } from "@/server/supabase";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <div className="flex min-h-dvh">
      <AppSidebar theme={theme} email={user.email ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-surface-overlay pr-1 pl-4 backdrop-blur-[12px] lg:hidden">
          <span className="text-title">Cifra</span>
          <ThemeToggle initial={theme} />
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-28 lg:px-16 lg:pt-12 lg:pb-12">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
