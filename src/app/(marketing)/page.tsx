import type { Metadata } from "next";
import { HeroWithMockup } from "@/components/blocks/hero-with-mockup";
import { PovCompare } from "@/components/blocks/pov-compare";
import { ProductDemo } from "@/components/sections/product-demo";
import { Platforms } from "@/components/sections/platforms";
import { Advantages } from "@/components/sections/advantages";
import { Solutions } from "@/components/sections/solutions";
import { Reviews } from "@/components/sections/reviews";
import { Companies } from "@/components/sections/companies";
import { Privacy } from "@/components/sections/privacy";
import { Pricing } from "@/components/sections/pricing";
import { SoftwareApplicationJsonLd } from "@/components/seo/json-ld";

export const metadata: Metadata = {
  description:
    "Smallbird listens, understands your context, and helps you respond well — right when your interview matters most. Free to download for Windows and macOS.",
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return (
    <>
      <SoftwareApplicationJsonLd />
      <HeroWithMockup
        eyebrow="AI assistance for important conversations"
        title="Real-time AI assistance, right when the conversation matters."
        description="Smallbird listens, understands your context, and helps you respond well — right when your interview matters most."
        mockup={
          <PovCompare className="rounded-2xl border border-border shadow-[0_20px_60px_-20px_rgba(0,0,0,0.35)]" />
        }
      />
      <ProductDemo />
      <Platforms />
      <Advantages />
      <Solutions />
      <Reviews />
      <Companies />
      <Privacy />
      <Pricing />
    </>
  );
}
