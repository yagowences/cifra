export const ASSET_CLASSES = [
  { value: "CASH", label: "Conta corrente", icon: "wallet" },
  { value: "FIXED_INCOME", label: "Renda fixa", icon: "landmark" },
  { value: "VARIABLE_INCOME", label: "Renda variável", icon: "trending-up" },
  { value: "REAL_ESTATE", label: "Imóvel", icon: "house" },
  { value: "CRYPTO", label: "Cripto", icon: "sparkles" },
  { value: "VEHICLE", label: "Veículo", icon: "car" },
  { value: "OTHER", label: "Outro", icon: "circle-ellipsis" },
] as const;

export type AssetClassValue = (typeof ASSET_CLASSES)[number]["value"];

export const assetClassLabel = (cls: string) => ASSET_CLASSES.find((c) => c.value === cls)?.label ?? cls;

export type AssetListItem = {
  id: string;
  name: string;
  class: AssetClassValue;
  /** Centavos como string, sempre positivo. */
  currentValue: string;
  isLiability: boolean;
};
