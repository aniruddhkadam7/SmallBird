"use client"

import { useSyncExternalStore } from "react"

// Festive decoration for themed sales (site_promotions.theme, set in the
// admin console), in the style of big e-commerce festive sales: decoration
// around the page, not effects over it. Diwali: a marigold toran under the
// banner, glowing lanterns swinging at the page edges, golden sparkles
// rising gently. New Year: twinkling fairy lights and stars. Confetti: one
// light shower on arrival. Motion is CSS only (globals.css "festive-*") and
// stops for visitors who ask for reduced motion. Nothing here takes clicks.
// `?festive=<theme>` previews a theme on any page without publishing it.

import { FESTIVE_THEMES, type FestiveTheme } from "@/lib/festive"

export type { FestiveTheme }

const noSubscribe = () => () => {}
function previewTheme(): FestiveTheme | null {
  const param = new URLSearchParams(window.location.search).get("festive") as FestiveTheme | null
  return param && FESTIVE_THEMES.includes(param) ? param : null
}

/// The `?festive=` preview theme, if any (null during server render).
export function useFestivePreview(): FestiveTheme | null {
  return useSyncExternalStore(noSubscribe, previewTheme, () => null)
}

// Same "random" layout on server and client, so hydration matches.
function rand(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

// Points along one garland swag: a curve from (0,4) dipping to the middle.
const SEG = 72
function swag(t: number): [number, number] {
  const [x0, y0, cx, cy, x1, y1] = [0, 4, SEG / 2, 34, SEG, 4]
  const u = 1 - t
  return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]
}
const SEGMENTS = 40 // enough to cross a wide screen; the rest is clipped


/// A clay diya with a flickering flame and a warm glow.
export function Diya({ size = 48, delay = 0, className = "" }: { size?: number; delay?: number; className?: string }) {
  return (
    <svg width={size} height={size * 0.92} viewBox="0 0 60 55" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="diya-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFE8A3" stopOpacity="0.9" />
          <stop offset="0.5" stopColor="#FFB703" stopOpacity="0.35" />
          <stop offset="1" stopColor="#FFB703" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="diya-flame" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#FF6B00" />
          <stop offset="0.45" stopColor="#FFB703" />
          <stop offset="1" stopColor="#FFF3B0" />
        </linearGradient>
        <linearGradient id="diya-clay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E8590C" />
          <stop offset="1" stopColor="#8A2C0D" />
        </linearGradient>
      </defs>
      <circle cx="30" cy="20" r="19" fill="url(#diya-glow)" className="festive-blink" style={{ animationDelay: `${delay}s` }} />
      {/* Flame, flickering from its base. */}
      <g className="festive-flicker" style={{ animationDelay: `${delay}s`, transformBox: "fill-box", transformOrigin: "bottom center" }}>
        <path d="M30 6 C35 15 37 22 30 30 C23 22 25 15 30 6 Z" fill="url(#diya-flame)" />
        <path d="M30 16 C32 21 32 25 30 28 C28 25 28 21 30 16 Z" fill="#FFFDF0" />
      </g>
      <path d="M30 29 L30 33" stroke="#3A1F0B" strokeWidth="1.5" />
      {/* Clay bowl with a spout, painted rim and dots. */}
      <path d="M6 32 Q30 30 50 32 L57 29 Q55 35 50 36 Q46 50 30 51 Q12 50 8 38 Q5 35 6 32 Z" fill="url(#diya-clay)" />
      <ellipse cx="30" cy="32.5" rx="23" ry="3" fill="#F08C00" />
      <ellipse cx="30" cy="32.5" rx="19" ry="1.8" fill="#5C1A05" />
      <path d="M12 41 Q30 47 48 41" stroke="#FFD166" strokeWidth="1.3" fill="none" />
      {[16, 23, 30, 37, 44].map((x) => (
        <circle key={x} cx={x} cy={x === 30 ? 45.5 : x === 23 || x === 37 ? 44.8 : 43.6} r="1.2" fill="#FFF3B0" />
      ))}
    </svg>
  )
}

function DiyaCorner({ side }: { side: "left" | "right" }) {
  return (
    <div
      className="pointer-events-none fixed bottom-2 z-[45] hidden items-end gap-1 min-[1440px]:flex"
      style={{ [side]: 12, flexDirection: side === "left" ? "row" : "row-reverse" }}
      aria-hidden="true"
    >
      <Diya size={54} delay={0} />
      <Diya size={42} delay={0.6} />
      <Diya size={34} delay={1.1} />
    </div>
  )
}

function MarigoldSegment() {
  return (
    <svg width={SEG} height={30} viewBox={`0 0 ${SEG} 30`} className="shrink-0" aria-hidden="true">
      {/* Mango leaf hanging at the peak. */}
      <path d="M0 3 C-5 10 -3 18 0 22 C3 18 5 10 0 3 Z" fill="#2D6A4F" />
      <path d="M0 3 L0 21" stroke="#1B4332" strokeWidth="0.8" />
      {[0.14, 0.28, 0.42, 0.56, 0.7, 0.84].map((t, i) => {
        const [x, y] = swag(t)
        const yellow = i % 2 === 1
        return (
          <g key={t} transform={`translate(${x} ${y - 6})`}>
            <circle r="6" fill={yellow ? "#FFB703" : "#F77F00"} />
            <circle r="4.2" fill={yellow ? "#FFD166" : "#FB8500"} />
            <circle r="1.8" fill={yellow ? "#F48C06" : "#D9480F"} />
          </g>
        )
      })}
    </svg>
  )
}

/// A few swags of the marigold toran, for the top of the sale popup.
export function MarigoldStrip({ segments = 8 }: { segments?: number }) {
  return (
    <div className="flex w-full min-w-0 justify-center overflow-hidden" aria-hidden="true">
      {Array.from({ length: segments }, (_, i) => (
        <MarigoldSegment key={i} />
      ))}
    </div>
  )
}

function FairyLightsSegment({ index }: { index: number }) {
  const bulbs = [0.16, 0.38, 0.62, 0.84]
  const colors = ["#FFE066", "#9BF6FF", "#FFC6FF", "#FFFFFF"]
  return (
    <svg width={SEG} height={30} viewBox={`0 0 ${SEG} 30`} className="shrink-0" aria-hidden="true">
      <path d={`M0 4 Q${SEG / 2} 34 ${SEG} 4`} fill="none" stroke="#475569" strokeWidth="1" />
      {bulbs.map((t, i) => {
        const [x, y] = swag(t)
        const color = colors[(index + i) % colors.length]
        return (
          <circle
            key={t}
            cx={x}
            cy={y - 4}
            r="3.4"
            fill={color}
            className="festive-twinkle"
            style={{
              animationDuration: `${1.6 + rand(index * 4 + i, 1) * 1.6}s`,
              animationDelay: `${rand(index * 4 + i, 2) * 2}s`,
              filter: `drop-shadow(0 0 4px ${color})`,
              transformBox: "fill-box",
              transformOrigin: "center",
            }}
          />
        )
      })}
    </svg>
  )
}

function Lantern({ hue, delay }: { hue: [string, string]; delay: number }) {
  return (
    <svg width="44" height="78" viewBox="0 0 44 78" aria-hidden="true">
      <defs>
        <linearGradient id={`lantern-${hue[0]}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={hue[0]} />
          <stop offset="1" stopColor={hue[1]} />
        </linearGradient>
        <radialGradient id="lantern-light" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFF3B0" stopOpacity="0.95" />
          <stop offset="1" stopColor="#FFD166" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="16" y="0" width="12" height="5" rx="1.5" fill="#D4A017" />
      {/* Akash kandil: a diamond body with a glowing heart. */}
      <path d="M22 5 L40 26 L22 54 L4 26 Z" fill={`url(#lantern-${hue[0]})`} stroke="#B8860B" strokeWidth="1.2" />
      <path d="M4 26 L40 26" stroke="#FFD166" strokeWidth="1" opacity="0.8" />
      <ellipse cx="22" cy="28" rx="11" ry="13" fill="url(#lantern-light)" className="festive-glow" style={{ animationDelay: `${delay}s` }} />
      {/* Tassels. */}
      {[14, 18, 22, 26, 30].map((x, i) => (
        <path key={x} d={`M22 54 Q${x} 62 ${x} ${70 + (i % 2) * 4}`} stroke={i % 2 ? "#FFB703" : "#E85D04"} strokeWidth="1.4" fill="none" />
      ))}
    </svg>
  )
}

function HangingLantern({ side, offset, cord, hue, delay }: { side: "left" | "right"; offset: string; cord: number; hue: [string, string]; delay: number; wide?: boolean }) {
  return (
    <div
      className="festive-swing absolute top-0 flex flex-col items-center"
      style={{ [side]: offset, animationDelay: `${delay}s` }}
    >
      <div style={{ height: cord }} className="w-px bg-[#B8860B]" />
      <Lantern hue={hue} delay={delay} />
    </div>
  )
}

// Kept in the empty margins beside the 1280px-wide page content: one per
// side from 1440px, a second from 1700px.
const LANTERNS: { side: "left" | "right"; offset: string; cord: number; hue: [string, string]; delay: number; wide?: boolean }[] = [
  { side: "left", offset: "1%", cord: 70, hue: ["#FF6B6B", "#C1121F"], delay: 0 },
  { side: "left", offset: "4.5%", cord: 150, hue: ["#FFB703", "#E85D04"], delay: 0.8, wide: true },
  { side: "right", offset: "4.5%", cord: 130, hue: ["#F72585", "#7209B7"], delay: 0.4, wide: true },
  { side: "right", offset: "1%", cord: 60, hue: ["#FFB703", "#E85D04"], delay: 1.2 },
]

function Sparkles({ count, colors, star }: { count: number; colors: string[]; star?: boolean }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const size = 3 + rand(i, 3) * 4
        const color = colors[i % colors.length]
        const style = {
          // Left or right margin only: 0.5%-5% from either edge.
          [rand(i, 13) < 0.5 ? "left" : "right"]: `${0.5 + rand(i, 4) * 4.5}%`,
          animationDuration: `${(star ? 2 : 7) + rand(i, 5) * (star ? 2.5 : 6)}s`,
          animationDelay: `${rand(i, 6) * 6}s`,
          color,
        }
        return star ? (
          <span key={i} className="festive-twinkle absolute text-xs" style={{ ...style, top: `${8 + rand(i, 7) * 80}%` }}>
            ✦
          </span>
        ) : (
          <span
            key={i}
            className="festive-rise absolute rounded-full"
            style={{ ...style, bottom: `${rand(i, 7) * 30}%`, width: size, height: size, background: color, boxShadow: `0 0 ${size * 2}px ${color}` }}
          />
        )
      })}
    </>
  )
}

function Confetti() {
  const colors = ["#4361EE", "#F72585", "#4CC9F0", "#FFD166", "#06D6A0"]
  return (
    <>
      {Array.from({ length: 40 }, (_, i) => (
        <span
          key={i}
          className="festive-fall absolute top-0 block"
          style={{
            left: `${rand(i, 8) * 100}%`,
            width: 6 + rand(i, 9) * 5,
            height: 3 + rand(i, 10) * 3,
            background: colors[i % colors.length],
            animationDuration: `${3 + rand(i, 11) * 2.5}s`,
            animationDelay: `${rand(i, 12) * 1.5}s`,
            opacity: 0,
          }}
        />
      ))}
    </>
  )
}

/// Goes right under the announcement banner: the garland strip in the page
/// flow, and the lanterns/sparkles over the top of the page behind the nav.
export function FestiveDecor({ theme }: { theme: FestiveTheme }) {
  const preview = useFestivePreview()
  const active = preview ?? theme
  if (active === "none") return null

  return (
    <div className="relative z-[45]" aria-hidden="true">
      {active === "diwali" || active === "newyear" ? (
        <div className="flex overflow-hidden">
          {Array.from({ length: SEGMENTS }, (_, i) =>
            active === "diwali" ? <MarigoldSegment key={i} /> : <FairyLightsSegment key={i} index={i} />,
          )}
        </div>
      ) : null}
      {/* Hangs from just under the garland, over the top of the page. */}
      <div className="pointer-events-none absolute inset-x-0 top-full h-[620px] overflow-hidden">
        {active === "diwali" && (
          <>
            <DiyaCorner side="left" />
            <DiyaCorner side="right" />
            <div className="hidden min-[1440px]:block">
              {LANTERNS.filter((l) => !l.wide).map((l) => (
                <HangingLantern key={`${l.side}${l.offset}`} {...l} />
              ))}
            </div>
            <div className="hidden min-[1700px]:block">
              {LANTERNS.filter((l) => l.wide).map((l) => (
                <HangingLantern key={`${l.side}${l.offset}`} {...l} />
              ))}
            </div>
            <div className="hidden min-[1440px]:block">
              <Sparkles count={18} colors={["#FFD166", "#FFB703", "#FFE8A3"]} />
            </div>
          </>
        )}
        {active === "newyear" && (
          <div className="hidden min-[1440px]:block">
            <Sparkles count={22} colors={["#FFD700", "#C0C0C0", "#9BF6FF"]} star />
          </div>
        )}
        {active === "confetti" && <Confetti />}
      </div>
    </div>
  )
}

