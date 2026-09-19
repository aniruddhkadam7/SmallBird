"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useState, type ChangeEvent } from "react"
import { FileText, Upload } from "lucide-react"
import logo from "@/assets/smallbird-logo.png"
import { getEntitlement, type Entitlement } from "@/lib/mobile/api"
import { EMPTY_PROFILE, type Profile } from "@/lib/mobile/answer"
import { DOCUMENT_ACCEPT, readDocument } from "@/lib/mobile/documents"
import { prepareAudio, type PreparedAudio } from "@/lib/mobile/mic"
import { usePurchaseFlow } from "@/lib/purchase-flow"

const PROFILE_KEY = "smallbird:web-profile"

export type DocumentKind = "resume" | "jobDescription"

export function loadProfile(): Profile {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY)
    if (raw) {
      // Field by field: an older saved profile (with a free-text "background") must not leak unknown shapes in.
      const saved = JSON.parse(raw) as Partial<Profile>
      const text = (value: unknown) => (typeof value === "string" ? value : "")
      return {
        company: text(saved.company),
        role: text(saved.role),
        resume: text(saved.resume),
        resumeName: text(saved.resumeName),
        jobDescription: text(saved.jobDescription),
        jobDescriptionName: text(saved.jobDescriptionName),
      }
    }
  } catch {
    // Blocked or corrupt storage (or no window during the server render): start blank.
  }
  return EMPTY_PROFILE
}

function saveProfile(profile: Profile): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch {
    // Not persisting is fine; the values are still used for this session.
  }
}

interface SlotProps {
  label: string
  hint: string
  name: string
  characters: number
  busy: boolean
  error: string
  onPick: (file: File) => void
  onRemove: () => void
}

function DocumentSlot({ label, hint, name, characters, busy, error, onPick, onRemove }: SlotProps) {
  return (
    <div className="field">
      <span>{label}</span>
      {name ? (
        <div className="doc-chip">
          <FileText className="doc-icon" aria-hidden />
          <div className="doc-meta">
            <strong>{name}</strong>
            <small>{characters.toLocaleString()} characters read</small>
          </div>
          <button type="button" className="textbtn" onClick={onRemove}>
            Remove
          </button>
        </div>
      ) : (
        <label className={busy ? "upload busy" : "upload"}>
          <input
            type="file"
            accept={DOCUMENT_ACCEPT}
            disabled={busy}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0]
              event.target.value = ""
              if (file) onPick(file)
            }}
          />
          <Upload className="upload-icon" aria-hidden />
          <span className="upload-text">{busy ? "Reading your file…" : hint}</span>
        </label>
      )}
      {error && <p className="notice error">{error}</p>}
    </div>
  )
}

interface ViewProps {
  email: string
  profile: Profile
  entitlement: Entitlement | null
  entitlementError: string
  busy: DocumentKind | null
  documentErrors: Record<DocumentKind, string>
  onChange: (patch: Partial<Profile>) => void
  onPickDocument: (kind: DocumentKind, file: File) => void
  onRemoveDocument: (kind: DocumentKind) => void
  onSignOut: () => void
  /** Both are called straight from the tap so the audio can be prepared inside it (see prepareAudio). */
  onStart: () => void
  onTestMic: () => void
}

export function SetupView({
  email,
  profile,
  entitlement,
  entitlementError,
  busy,
  documentErrors,
  onChange,
  onPickDocument,
  onRemoveDocument,
  onSignOut,
  onStart,
  onTestMic,
}: ViewProps) {
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
          <span>Role</span>
          <input value={profile.role} onChange={(e) => onChange({ role: e.target.value })} placeholder="e.g. Senior Backend Engineer" />
        </label>
        <label className="field">
          <span>Company</span>
          <input value={profile.company} onChange={(e) => onChange({ company: e.target.value })} placeholder="e.g. Google" />
        </label>
        <DocumentSlot
          label="Resume / CV"
          hint="Upload your CV (PDF, DOCX or TXT)"
          name={profile.resumeName}
          characters={profile.resume.length}
          busy={busy === "resume"}
          error={documentErrors.resume}
          onPick={(file) => onPickDocument("resume", file)}
          onRemove={() => onRemoveDocument("resume")}
        />
        <DocumentSlot
          label="Job description (optional)"
          hint="Upload the job description (PDF, DOCX or TXT)"
          name={profile.jobDescriptionName}
          characters={profile.jobDescription.length}
          busy={busy === "jobDescription"}
          error={documentErrors.jobDescription}
          onPick={(file) => onPickDocument("jobDescription", file)}
          onRemove={() => onRemoveDocument("jobDescription")}
        />
        <p className="fineprint">Answers use your CV, the role and the job description. Files are read on your phone and never uploaded.</p>
      </section>

      <div className="actions-col">
        <button type="button" className="btn primary big" onClick={onStart} disabled={outOfMinutes || busy !== null}>
          Start interview
        </button>
        <button type="button" className="btn small" onClick={onTestMic} disabled={outOfMinutes || busy !== null}>
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
  const [busy, setBusy] = useState<DocumentKind | null>(null)
  const [documentErrors, setDocumentErrors] = useState<Record<DocumentKind, string>>({ resume: "", jobDescription: "" })

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

  async function pickDocument(kind: DocumentKind, file: File) {
    setBusy(kind)
    setDocumentErrors((prev) => ({ ...prev, [kind]: "" }))
    try {
      const doc = await readDocument(file)
      update(kind === "resume" ? { resume: doc.text, resumeName: doc.filename } : { jobDescription: doc.text, jobDescriptionName: doc.filename })
    } catch (err) {
      setDocumentErrors((prev) => ({ ...prev, [kind]: err instanceof Error ? err.message : "Couldn't read that file." }))
    } finally {
      setBusy(null)
    }
  }

  function removeDocument(kind: DocumentKind) {
    update(kind === "resume" ? { resume: "", resumeName: "" } : { jobDescription: "", jobDescriptionName: "" })
  }

  return (
    <SetupView
      email={email}
      profile={profile}
      entitlement={entitlement}
      entitlementError={entitlementError}
      busy={busy}
      documentErrors={documentErrors}
      onChange={update}
      onPickDocument={(kind, file) => void pickDocument(kind, file)}
      onRemoveDocument={removeDocument}
      onSignOut={() => void logout()}
      // prepareAudio() must run synchronously inside the tap, before anything is awaited.
      onStart={() => onStart(prepareAudio())}
      onTestMic={() => onTestMic(prepareAudio())}
    />
  )
}
