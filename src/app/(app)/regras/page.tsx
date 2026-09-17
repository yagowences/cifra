import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { ListaRegras, type RuleListItem } from "@/components/rules/lista-regras";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { ruleActionsSchema, ruleConditionsSchema } from "@/server/services/categorize";

export const metadata: Metadata = { title: "Regras" };

export default async function RegrasPage() {
  const userId = await requireUserId();
  const { rules, categories } = await forUser(userId, async (tx) => ({
    rules: await tx.automationRule.findMany({ where: { userId }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }] }),
    categories: await tx.category.findMany({ where: { userId }, orderBy: [{ type: "desc" }, { sortOrder: "asc" }], select: { id: true, name: true, type: true, icon: true, color: true } }),
  }));
  const nameById = new Map(categories.map((c) => [c.id, c.name]));

  const items: RuleListItem[] = rules.flatMap((r) => {
    const conditions = ruleConditionsSchema.safeParse(r.conditions);
    const actions = ruleActionsSchema.safeParse(r.actions);
    if (!conditions.success || !actions.success) return [];
    return [{ id: r.id, name: r.name, contains: conditions.data.descriptionContains, type: conditions.data.type ?? null, categoryName: nameById.get(actions.data.categoryId) ?? "?", active: r.active, hitCount: r.hitCount }];
  });

  return (
    <>
      <PageHeader title="Regras" />
      <ListaRegras rules={items} categories={categories} />
    </>
  );
}
