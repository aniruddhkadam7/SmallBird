"use client";

import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";
import { PricesPanel } from "@/components/pricing/PricesPanel";
import { SalePanel } from "@/components/pricing/SalePanel";
import { AnnouncementPanel } from "@/components/pricing/AnnouncementPanel";
import type { PricingData } from "@/lib/pricing";

// Prices, sales and the website announcement. Everything here is read live
// by smallbirdai.com (and checkout), so no deploy is needed for any change.
export default function PricingPage() {
  const { data, error, mutate } = useAdminQuery<PricingData>("admin-pricing", { type: "get" });

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (error) return <p className="text-sm text-danger">Couldn&apos;t load pricing: {error.message}</p>;
  if (!data) return <PageLoading />;

  const refresh = () => void mutate();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Pricing & Offers</h1>
        <p className="mt-1 text-sm text-muted">
          Change prices, run sales and put an announcement on the website. Changes show on smallbirdai.com within about a
          minute, and every change is recorded in the audit log.
        </p>
      </div>

      <SalePanel plans={data.plans} onChanged={refresh} />
      <AnnouncementPanel promotions={data.promotions} onChanged={refresh} />
      <PricesPanel plans={data.plans} onChanged={refresh} />
    </div>
  );
}
