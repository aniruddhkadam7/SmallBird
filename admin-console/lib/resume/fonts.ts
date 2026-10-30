// Copied from SmallBird-website (same path there) so the admin console draws
// resumes exactly as the user sees and prints them. Keep in step with it.

import { Fira_Sans, Lato, Raleway, STIX_Two_Text } from "next/font/google"

// Fonts for the printed resume (app/resume/resume.css): STIX (a common LaTeX
// serif) for Navy Formal, Lato for Classic Tech and Modern Blue, Fira Sans for
// Grey Sidebar, Raleway for Bold Header. Put `resumeFonts` on any element
// that wraps a ResumePreview.
const serif = STIX_Two_Text({
  variable: "--font-resume-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
})

const sans = Lato({
  variable: "--font-resume-sans",
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
})

const fira = Fira_Sans({
  variable: "--font-resume-fira",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
})

const raleway = Raleway({
  variable: "--font-resume-raleway",
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  style: ["normal", "italic"],
})

export const resumeFonts = `${serif.variable} ${sans.variable} ${fira.variable} ${raleway.variable}`
