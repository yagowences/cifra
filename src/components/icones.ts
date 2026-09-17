import {
  Banknote,
  Briefcase,
  Car,
  CircleDashed,
  CircleEllipsis,
  CirclePlus,
  CreditCard,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  Laptop,
  PawPrint,
  PiggyBank,
  Plane,
  Repeat,
  ShoppingBag,
  Sparkles,
  Ticket,
  TrendingUp,
  Utensils,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * Ícones que o Cifra usa para categorias e contas, por nome kebab-case como fica no banco.
 * Mapa estático (tree-shaken) em vez de carregamento dinâmico, que quebra no webpack.
 */
export const ICONES: Record<string, LucideIcon> = {
  house: House,
  utensils: Utensils,
  car: Car,
  "heart-pulse": HeartPulse,
  "graduation-cap": GraduationCap,
  ticket: Ticket,
  "shopping-bag": ShoppingBag,
  repeat: Repeat,
  "paw-print": PawPrint,
  landmark: Landmark,
  sparkles: Sparkles,
  gift: Gift,
  plane: Plane,
  "circle-ellipsis": CircleEllipsis,
  briefcase: Briefcase,
  laptop: Laptop,
  "trending-up": TrendingUp,
  "circle-plus": CirclePlus,
  "piggy-bank": PiggyBank,
  "credit-card": CreditCard,
  banknote: Banknote,
  wallet: Wallet,
};

export const iconeOuPadrao = (name?: string | null): LucideIcon => (name && ICONES[name]) || CircleDashed;
