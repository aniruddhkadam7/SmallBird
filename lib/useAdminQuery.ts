"use client";

// Client-side data fetching with caching: SWR keeps each request's result in
// memory keyed by (functionName, body). The first visit to a page still
// waits on the network, but every later visit -- including navigating away
// and back -- shows the cached result instantly while quietly re-fetching in
// the background, the same pattern Gmail/Notion/etc. use.
import useSWR, { mutate as globalMutate, type SWRConfiguration } from "swr";
import { createClient } from "@/lib/supabase/client";
import { callAdminFunction, AdminApiError } from "@/lib/adminApi";

export { AdminApiError };

async function fetchAdminFunction<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new AdminApiError(401, "Not signed in");
  return callAdminFunction<T>(session.access_token, functionName, body);
}

export function useAdminQuery<T>(
  functionName: string,
  body: Record<string, unknown> = {},
  options?: SWRConfiguration,
) {
  const key = [functionName, JSON.stringify(body)];

  const { data, error, isLoading, isValidating, mutate } = useSWR<T>(
    key,
    () => fetchAdminFunction<T>(functionName, body),
    {
      revalidateOnFocus: true,
      dedupingInterval: 4000,
      ...options,
    },
  );

  return { data, error, isLoading, isValidating, mutate };
}

// Warms the SWR cache for a query before the component that needs it ever
// mounts -- e.g. on row hover, so a modal opened a moment later on click
// finds the data already there instead of showing "Loading..." while an
// Edge Function round trip (which can be slow on a cold start) runs. Safe to
// call repeatedly; SWR's own deduping keeps it from spamming the network.
export function prefetchAdminQuery<T>(functionName: string, body: Record<string, unknown> = {}) {
  const key = [functionName, JSON.stringify(body)];
  globalMutate(key, fetchAdminFunction<T>(functionName, body), { revalidate: false });
}
