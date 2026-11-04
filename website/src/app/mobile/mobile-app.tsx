"use client"

import { useState, useSyncExternalStore } from "react"
import type { Profile } from "@/lib/mobile/answer"
import type { PreparedAudio } from "@/lib/mobile/mic"
import type { SessionResult } from "@/lib/mobile/types"
import Live from "./live"
import MicTest from "./mic-test"
import Setup, { loadProfile } from "./setup"
import Summary from "./summary"

type Screen = "setup" | "mic" | "live" | "summary"

// The whole mobile interview flow after sign-in. Signing in is not handled
// here: this page is only rendered for a visitor the server has already
// verified via the website's own session (see page.tsx).
export function MobileApp({ email }: { email: string }) {
  const [screen, setScreen] = useState<Screen>("setup")
  // Audio prepared inside the tap that opened the current screen (see
  // prepareAudio in lib/mobile/mic.ts): iOS only starts audio inside a tap.
  const [audio, setAudio] = useState<PreparedAudio | null>(null)
  // loadProfile() reads localStorage, which the server render doesn't have
  // (it returns a blank profile there). Nothing is rendered until hydration
  // is done, so the server and first client render both output nothing and
  // can't mismatch, while the state already holds the saved profile.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  const [profile, setProfile] = useState<Profile>(loadProfile)
  const [result, setResult] = useState<SessionResult | null>(null)

  if (!hydrated) return null

  function go(next: Screen, prepared: PreparedAudio | null = null) {
    setAudio(prepared)
    setScreen(next)
  }

  switch (screen) {
    case "mic":
      return <MicTest audio={audio} onDone={() => go("setup")} onStartInterview={(prepared) => go("live", prepared)} />
    case "live":
      return (
        <Live
          profile={profile}
          audio={audio}
          onCancel={() => go("setup")}
          onFinished={(finished) => {
            setResult(finished)
            go("summary")
          }}
        />
      )
    case "summary":
      return result ? <Summary result={result} onDone={() => go("setup")} /> : null
    default:
      return (
        <Setup
          email={email}
          profile={profile}
          onProfile={setProfile}
          onStart={(prepared) => go("live", prepared)}
          onTestMic={(prepared) => go("mic", prepared)}
        />
      )
  }
}
