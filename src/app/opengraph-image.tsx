import { ImageResponse } from "next/og"

export const runtime = "edge"
export const alt = "Smallbird — AI Assistant"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f0f12 0%, #1c1c22 100%)",
          color: "#f5f5f5",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -2, display: "flex" }}>
          Smallbird
        </div>
        <div style={{ fontSize: 32, marginTop: 24, color: "#a3a3ad", display: "flex" }}>
          Real-time AI assistance for interviews
        </div>
      </div>
    ),
    { ...size },
  )
}
