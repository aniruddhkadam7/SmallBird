import type { Metadata } from "next";
import Image from "next/image";
import { HeroWithMockup } from "@/components/blocks/hero-with-mockup";
import { PovCompare } from "@/components/blocks/pov-compare";
import { ProductDemo } from "@/components/sections/product-demo";
import { Platforms } from "@/components/sections/platforms";
import { Advantages } from "@/components/sections/advantages";
import { Reviews } from "@/components/sections/reviews";
import { Companies } from "@/components/sections/companies";
import { Privacy } from "@/components/sections/privacy";
import { Pricing } from "@/components/sections/pricing";
import { SoftwareApplicationJsonLd } from "@/components/seo/json-ld";
import autoAnswerMobile from "@/assets/auto-answer-mobile.webp";

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
          <>
            {/* Phones get the portrait Auto-answer recording; the wide
                candidate/interviewer comparison is unreadable at that width. */}
            {/* Bleeds into the hero's 16px side padding: the phone art has
                transparent margins for its floating icons, so at plain
                content width the phone itself looked narrow. */}
            <div className="-mx-4 md:hidden">
              <Image
                src={autoAnswerMobile}
                alt="Smallbird answering an interview question automatically on a phone"
                unoptimized
                className="mx-auto h-auto w-full max-w-[460px]"
              />
            </div>
            <div className="hidden md:block">
              <PovCompare className="rounded-2xl border border-border shadow-[0_20px_60px_-20px_rgba(0,0,0,0.35)]" />
            </div>
          </>
        }
      />
      <ProductDemo />
      <Platforms />
      <Advantages />
      <Reviews />
      <Companies />
      <Privacy />
      <Pricing />
    </>
  );
}
