"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useState, type ChangeEvent } from "react"
import logo from "@/assets/smallbird-logo.png"
import { getEntitlement, type Entitlement } from "@/lib/mobile/api"
import type { Profile } from "@/lib/mobile/answer"
import { prepareAudio, type PreparedAudio } from "@/lib/mobile/mic"
import { usePurchaseFlow } from "@/lib/purchase-flow"

const PROFILE_KEY = "smallbird:web-profile"

export function loadProfile(): Profile {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY)
    if (raw) return { company: "", role: "", background: "", ...(JSON.parse(raw) as Partial<Profile>) }
  } catch {
    // Blocked or corrupt storage (or no window during the server render): start blank.
  }
  return { company: "", role: "", background: "" }
}

function saveProfile(profile: Profile): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch {
    // Not persisting is fine; the values are still used for this session.
  }
}

interface ViewProps {
  email: string
  profile: Profile
  entitlement: Entitlement | null
  entitlementError: string
  onChange: (patch: Partial<Profile>) => void
  onLoadFile: (event: ChangeEvent<HTMLInputElement>) => void
  onSignOut: () => void
  /** Both are called straight from the tap so the audio can be prepared inside it (see prepareAudio). */
  onStart: () => void
  onTestMic: () => void
}

export function SetupView({ email, profile, entitlement, entitlementError, onChange, onLoadFile, onSignOut, onStart, onTestMic }: ViewProps) {
  const outOfMinutes = entitlement !== null && entitlement.remainingMinutes <= 0

  return (
    <main className="page">
      <nav className="nav-row">
        <Link href="/" className="back">
          <span aria-hidden>‹</span> Back to smallbird.in
        </Link>
        <button type="button" className="textbtn" onClick={onSignOut}>
          Sign out
        </button>
      </nav>

      <div className="brand-row">
        <Image src={logo} alt="" className="logo" width={28} height={28} priority />
        <span className="wordmark">Smallbird</span>
      </div>

      <p className="account">
        {email}
        {entitlement && (
          <>
            {" "}
            · <strong>{Math.floor(entitlement.remainingMinutes)} min</strong> left
          </>
        )}
      </p>
      {entitlementError && <p className="notice error">{entitlementError}</p>}
      {outOfMinutes && <p className="notice error">You&apos;re out of minutes. Add more at smallbird.in to start an interview.</p>}

      <section className="card">
        <label className="field">
          <span>Company</span>
          <input value={profile.company} onChange={(e) => onChange({ company: e.target.value })} placeholder="e.g. Google" />
        </label>
        <label className="field">
          <span>Role</span>
          <input value={profile.role} onChange={(e) => onChange({ role: e.target.value })} placeholder="e.g. Senior Backend Engineer" />
        </label>
        <label className="field">
          <span>Your background</span>
          <textarea
            rows={7}
            value={profile.background}
            onChange={(e) => onChange({ background: e.target.value })}
            placeholder="Paste your resume and the job description here. Answers will use your real projects and skills."
          />
        </label>
        <label className="field file">
          <span>Or load a .txt / .md file</span>
          <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={onLoadFile} />
        </label>
      </section>

      <div className="actions-col">
        <button type="button" className="btn primary big" onClick={onStart} disabled={outOfMinutes}>
          Start interview
        </button>
        <button type="button" className="btn small" onClick={onTestMic} disabled={outOfMinutes}>
          Test microphone <span className="optional">(optional)</span>
        </button>
      </div>
    </main>
  )
}

interface Props {
  email: string
  profile: Profile
  onProfile: (profile: Profile) => void
  onStart: (audio: PreparedAudio | null) => void
  onTestMic: (audio: PreparedAudio | null) => void
}

export default function Setup({ email, profile, onProfile, onStart, onTestMic }: Props) {
  const { logout } = usePurchaseFlow()
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null)
  const [entitlementError, setEntitlementError] = useState("")

  useEffect(() => {
    getEntitlement().then(setEntitlement, (err: unknown) =>
      setEntitlementError(err instanceof Error ? err.message : "Couldn't load your plan."),
    )
  }, [])

  function update(patch: Partial<Profile>) {
    const next = { ...profile, ...patch }
    onProfile(next)
    saveProfile(next)
  }

  async function loadTextFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    update({ background: (await file.text()).trim() })
  }

  return (
    <SetupView
      email={email}
      profile={profile}
      entitlement={entitlement}
      entitlementError={entitlementError}
      onChange={update}
      onLoadFile={loadTextFile}
      onSignOut={() => void logout()}
      // prepareAudio() must run synchronously inside the tap, before anything is awaited.
      onStart={() => onStart(prepareAudio())}
      onTestMic={() => onTestMic(prepareAudio())}
    />
  )
}
