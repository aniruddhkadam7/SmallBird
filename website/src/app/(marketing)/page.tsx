import type { Metadata } from "next";
import Image from "next/image";
import { HeroWithMockup } from "@/components/blocks/hero-with-mockup";
import { PovCompare } from "@/components/blocks/pov-compare";
import { ProductDemo } from "@/components/sections/product-demo";
import { Platforms } from "@/components/sections/platforms";
import { Advantages } from "@/components/sections/advantages";
import { Reviews } from "@/components/sections/reviews";
import { ResumeBuilder } from "@/components/sections/resume-builder";
import { Companies } from "@/components/sections/companies";
import { Privacy } from "@/components/sections/privacy";
import { Pricing } from "@/components/sections/pricing";
import { SoftwareApplicationJsonLd } from "@/components/seo/json-ld";
import autoAnswerMobile from "@/assets/auto-answer-mobile.webp";

export const metadata: Metadata = {
  description:
    "SmallBird AI listens, understands your context, and helps you respond well — right when your interview matters most. Free to download for Windows and macOS.",
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return (
    <>
      <SoftwareApplicationJsonLd />
      <HeroWithMockup
        title="Real-time AI assistance, right when the conversation matters."
        titleHighlight="Real-time AI assistance"
        description="SmallBird AI listens, understands your context, and helps you respond well — right when your interview matters most."
        mockup={
          <>
            {/* Phones get the portrait Auto-answer recording; the wide
                candidate/interviewer comparison is unreadable at that width. */}
            <Image
              src={autoAnswerMobile}
              alt="SmallBird AI answering an interview question automatically on a phone"
              unoptimized
              className="mx-auto h-auto w-[86%] max-w-[340px] md:hidden"
            />
            <div className="hidden md:block">
              <PovCompare className="rounded-2xl border border-border shadow-[0_20px_60px_-20px_rgba(0,0,0,0.35)]" />
            </div>
          </>
        }
      />
      <ProductDemo />
      <Platforms />
      <Advantages />
      <ResumeBuilder />
      <Reviews />
      <Companies />
      <Privacy />
      <Pricing />
    </>
  );
}
