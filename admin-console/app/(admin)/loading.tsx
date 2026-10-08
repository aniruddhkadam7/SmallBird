// Next.js shows this immediately on navigation, before the destination
// route's shell mounts -- without it, clicking a nav tab just leaves the old
// page on screen (looking frozen) while that happens.
import { PageLoading } from "@/components/PageLoading";

export default function Loading() {
  return <PageLoading />;
}
