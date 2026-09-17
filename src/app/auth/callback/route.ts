import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/server/supabase";

/** Destino do link de confirmação de e-mail (fluxo PKCE). */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }

  return NextResponse.redirect(`${origin}/sign-in?erro=link`);
}
