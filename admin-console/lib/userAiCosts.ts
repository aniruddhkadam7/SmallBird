"use client";

// AI spend per user and per interview from admin-user-ai-costs: OpenAI's real
// bill shared out by usage when OPENAI_ADMIN_KEY is set, list-price
// estimates otherwise (costSource says which).
import { useAdminQuery } from "@/lib/useAdminQuery";

export interface UserAiCosts {
  costSource: "openai" | "estimate";
  usdToInr: number;
  users: Record<
    string,
    {
      totalUsd: number; // OpenAI
      calls: number;
      deepgramUsd: number; // exact, per interview key
      sessions: Record<string, { costUsd: number; calls: number; deepgramUsd: number }>;
    }
  >;
}

/// Deepgram cost in rupees: always Deepgram's own figure, never estimated.
export function formatDeepgramCost(usd: number, costs: Pick<UserAiCosts, "usdToInr"> | undefined): string {
  if (!costs) return "…";
  return `₹${(usd * costs.usdToInr).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function useUserAiCosts(userIds: string[]) {
  const { data } = useAdminQuery<UserAiCosts>("admin-user-ai-costs", { userIds }, { revalidateOnFocus: false });
  return data;
}

/// "₹11.76" -- or "Est. ₹…" when it's only the list-price estimate, and
/// "…" while it loads.
export function formatAiCost(usd: number, costs: Pick<UserAiCosts, "costSource" | "usdToInr"> | undefined): string {
  if (!costs) return "…";
  const inr = (usd * costs.usdToInr).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${costs.costSource === "estimate" ? "Est. " : ""}₹${inr}`;
}
