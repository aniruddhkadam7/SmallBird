"use client";

// Rough location (city, state, country, network) for an IP address we
// already record for each device (user_devices.last_ip), so the console can
// show where a user is without the apps asking them anything. Looked up from
// the admin's browser with ipwho.is (free, HTTPS, no key); SWR keeps each
// answer for the session so a page re-render doesn't look it up again. An IP
// is where the network is, not the person -- a mobile or office network can
// be a city or more off.
import useSWR from "swr";

export interface IpLocation {
  city: string | null;
  region: string | null;
  country: string | null;
  isp: string | null;
}

async function lookup(ip: string): Promise<IpLocation | null> {
  const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,city,region,country,connection`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.success) return null;
  return {
    city: data.city || null,
    region: data.region || null,
    country: data.country || null,
    isp: data.connection?.isp || data.connection?.org || null,
  };
}

export function useIpLocation(ip: string | null | undefined) {
  const { data } = useSWR(ip ? ["ip-location", ip] : null, () => lookup(ip!), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  });
  return data ?? null;
}

export function formatIpLocation(loc: IpLocation | null): string | null {
  if (!loc) return null;
  return [loc.city, loc.region, loc.country].filter(Boolean).join(", ") || null;
}
