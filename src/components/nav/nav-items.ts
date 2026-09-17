import { House, Landmark, MessageSquare, Receipt, Rows3, Target, Upload, Wallet, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Início", icon: House },
  { href: "/transacoes", label: "Transações", icon: Rows3 },
  { href: "/contas", label: "Contas", icon: Wallet },
  { href: "/importar", label: "Importar", icon: Upload },
  { href: "/comprovante", label: "Comprovante", icon: Receipt },
  { href: "/patrimonio", label: "Patrimônio", icon: Landmark },
  { href: "/metas", label: "Metas", icon: Target },
  { href: "/assistente", label: "Assistente", icon: MessageSquare },
];

export const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
