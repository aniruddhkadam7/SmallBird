import { HeroWithMockup } from "@/components/blocks/hero-with-mockup";
import { HeroGlassOverlay } from "@/components/blocks/hero-glass-overlay";
import { ProductDemo } from "@/components/sections/product-demo";
import { InterviewModeSection } from "@/components/sections/interview-mode";
import { HowItWorks } from "@/components/sections/how-it-works";
import { Advantages } from "@/components/sections/advantages";
import { Reviews } from "@/components/sections/reviews";
import { Privacy } from "@/components/sections/privacy";
import { Pricing } from "@/components/sections/pricing";
import { DownloadSection } from "@/components/sections/download";
import { FinalCta } from "@/components/sections/final-cta";

export default function Home() {
  return (
    <>
      <HeroWithMockup
        eyebrow="AI assistance for important conversations"
        title="Real-time AI assistance, right when the conversation matters."
        description="Smallbird listens, understands your context, and helps you respond well — right when your interview matters most."
        mockup={<HeroGlassOverlay />}
      />
      <ProductDemo />
      <InterviewModeSection />
      <HowItWorks />
      <Advantages />
      <Reviews />
      <Privacy />
      <Pricing />
      <DownloadSection />
      <FinalCta />
    </>
  );
}
