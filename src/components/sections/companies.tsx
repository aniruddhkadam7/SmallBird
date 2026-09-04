"use client"

import {
  siGoogle,
  siMeta,
  siNetflix,
  siApple,
  siAtlassian,
  siInfosys,
  siTcs,
  siWipro,
  siHcl,
  siAccenture,
  siSpotify,
  siZomato,
  siSwiggy,
  siPaytm,
} from "simple-icons"

// Only companies we actually have a real, official brand SVG for (via the
// open-source simple-icons set) -- no stand-in wordmarks for anyone missing.
const companies = [
  { name: "Google", color: `#${siGoogle.hex}`, icon: siGoogle },
  { name: "Meta", color: `#${siMeta.hex}`, icon: siMeta },
  { name: "Netflix", color: `#${siNetflix.hex}`, icon: siNetflix },
  { name: "Apple", color: "#1d1d1f", icon: siApple },
  { name: "Atlassian", color: `#${siAtlassian.hex}`, icon: siAtlassian },
  { name: "Infosys", color: `#${siInfosys.hex}`, icon: siInfosys },
  { name: "TCS", color: `#${siTcs.hex}`, icon: siTcs },
  { name: "Wipro", color: `#${siWipro.hex}`, icon: siWipro },
  { name: "HCLTech", color: `#${siHcl.hex}`, icon: siHcl },
  { name: "Accenture", color: `#${siAccenture.hex}`, icon: siAccenture },
  { name: "Spotify", color: `#${siSpotify.hex}`, icon: siSpotify },
  { name: "Zomato", color: `#${siZomato.hex}`, icon: siZomato },
  { name: "Swiggy", color: `#${siSwiggy.hex}`, icon: siSwiggy },
  { name: "Paytm", color: `#${siPaytm.hex}`, icon: siPaytm },
]

export function Companies() {
  return (
    <section className="border-t border-border py-12 sm:py-16">
      <div className="mx-auto max-w-5xl px-4 text-center">
        <p className="text-sm font-medium text-muted-foreground">
          Candidates using Smallbird have interviewed at companies like
        </p>
      </div>

      <div
        className="relative mt-10 overflow-hidden"
        style={{
          maskImage: "linear-gradient(to right, transparent, black 5%, black 95%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 5%, black 95%, transparent)",
        }}
      >
        <div className="animate-marquee flex w-max items-center gap-8">
          {[...companies, ...companies].map((company, i) => (
            <div
              key={`${company.name}-${i}`}
              className="flex shrink-0 flex-col items-center gap-3 px-8 py-4 transition-transform hover:scale-105"
              title={company.name}
            >
              <svg viewBox="0 0 24 24" className="h-14 w-14 sm:h-16 sm:w-16" fill={company.color} aria-hidden="true">
                <path d={company.icon.path} />
              </svg>
              <span className="text-sm font-semibold text-foreground">{company.name}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="mx-auto mt-6 max-w-xl px-4 text-center text-xs text-muted-foreground">
        Names shown reflect where our users have interviewed and are not affiliated with or endorsed by Smallbird.
      </p>
    </section>
  )
}
