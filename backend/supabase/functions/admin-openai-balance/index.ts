// OpenAI credit left + spend, for the admin console's AI usage page.
//
// OpenAI's API has no balance endpoint, so the balance comes from the
// admin-entered openai_balance_usd / openai_balance_set_at settings
// (0055_openai_balance_settings.sql), minus the real spend since then from
// OpenAI (needs the OPENAI_ADMIN_KEY secret, an sk-admin- key), read through
// the openai_daily_costs cache. admin_get_app_settings() embeds its own
// admin check, so nothing reaches OpenAI for a non-admin caller.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";
import { DAY, dayKey, getDailyCosts, getOpenAiAdminKey, usdToInr } from "../_shared/openaiCosts.ts";

function settingValue(settings: Record<string, { value?: string }>, key: string): string {
  return (settings[key]?.value ?? "").trim();
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const client = getUserClient(req);
    const { data: settings, error } = await client.rpc("admin_get_app_settings");
    if (error) throwOnRpcError(error);

    const adminKey = getOpenAiAdminKey();
    if (!adminKey) {
      return jsonResponse({ configured: false });
    }

    const balanceRaw = settingValue(settings ?? {}, "openai_balance_usd");
    const balanceSetAtRaw = settingValue(settings ?? {}, "openai_balance_set_at");
    const enteredBalance = balanceRaw === "" ? null : Number(balanceRaw);
    const balanceSetAt = balanceSetAtRaw ? Math.floor(Date.parse(balanceSetAtRaw) / 1000) : null;
    const hasBalance = enteredBalance !== null && Number.isFinite(enteredBalance) && balanceSetAt !== null && Number.isFinite(balanceSetAt);

    const now = Math.floor(Date.now() / 1000);
    const monthStart = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) / 1000);
    const last30Start = Math.floor(now / DAY) * DAY - 29 * DAY;
    // Fetch far enough back to cover the month, the 30-day chart, and the
    // balance's start day (whole UTC days, which is what OpenAI buckets by).
    const balanceDayStart = hasBalance ? Math.floor(balanceSetAt! / DAY) * DAY : now;
    const startTime = Math.min(monthStart, last30Start, balanceDayStart);

    // usd: the SmallBird key (what the card shows); orgUsd: every key in the
    // org, which the prepaid credit pays for (what credit left subtracts).
    const days = ((await getDailyCosts(dayKey(startTime))) ?? []).map((d) => ({
      day: Date.parse(`${d.day}T00:00:00Z`) / 1000,
      usd: d.appUsd,
      orgUsd: d.orgUsd,
    }));
    // Calls / people / interviews per day, for the chart's day details.
    const [{ data: activity }, inrRate] = await Promise.all([client.rpc("admin_usage_costs_daily", { p_days: 31 }), usdToInr()]);
    const todayStart = Math.floor(now / DAY) * DAY;
    const sumFrom = (from: number) => days.filter((d) => d.day >= from).reduce((s, d) => s + d.usd, 0);
    const orgSumFrom = (from: number) => days.filter((d) => d.day >= from).reduce((s, d) => s + d.orgUsd, 0);

    // OpenAI only reports whole days, so the spend on the day the balance was
    // entered is counted pro rata for the part of that day after entry.
    let spentSinceBalance: number | null = null;
    if (hasBalance) {
      const firstDay = days.find((d) => d.day === balanceDayStart)?.orgUsd ?? 0;
      const fractionAfter = (balanceDayStart + DAY - balanceSetAt!) / DAY;
      spentSinceBalance = firstDay * Math.min(1, Math.max(0, fractionAfter)) + orgSumFrom(balanceDayStart + DAY);
    }

    return jsonResponse({
      configured: true,
      enteredBalanceUsd: hasBalance ? enteredBalance : null,
      balanceSetAt: hasBalance ? balanceSetAtRaw : null,
      spentSinceBalanceUsd: spentSinceBalance,
      creditLeftUsd: hasBalance ? enteredBalance! - spentSinceBalance! : null,
      spentTodayUsd: sumFrom(todayStart),
      spentThisMonthUsd: sumFrom(monthStart),
      otherKeysThisMonthUsd: orgSumFrom(monthStart) - sumFrom(monthStart),
      usdToInr: inrRate,
      daily: days.filter((d) => d.day >= last30Start).map((d) => {
        const date = dayKey(d.day);
        return { date, usd: d.usd, otherKeysUsd: d.orgUsd - d.usd, ...(activity?.[date] ?? {}) };
      }),
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
