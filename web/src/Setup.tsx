import { useEffect, useState, type ChangeEvent } from "react";
import { getEntitlement, type Entitlement } from "./api";
import type { Profile } from "./answer";

const PROFILE_KEY = "smallbird:web-profile";

export function loadProfile(): Profile {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (raw) return { company: "", role: "", background: "", ...(JSON.parse(raw) as Partial<Profile>) };
  } catch {
    // Blocked or corrupt storage: start blank.
  }
  return { company: "", role: "", background: "" };
}

function saveProfile(profile: Profile): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Not persisting is fine; the values are still used for this session.
  }
}

interface Props {
  email: string;
  profile: Profile;
  onProfile: (profile: Profile) => void;
  onContinue: () => void;
  onSignOut: () => void;
}

export default function Setup({ email, profile, onProfile, onContinue, onSignOut }: Props) {
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [entitlementError, setEntitlementError] = useState("");

  useEffect(() => {
    getEntitlement().then(setEntitlement, (err: unknown) =>
      setEntitlementError(err instanceof Error ? err.message : "Couldn't load your plan."),
    );
  }, []);

  function update(patch: Partial<Profile>) {
    const next = { ...profile, ...patch };
    onProfile(next);
    saveProfile(next);
  }

  async function loadTextFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    update({ background: (await file.text()).trim() });
  }

  const outOfMinutes = entitlement !== null && entitlement.remainingMinutes <= 0;

  return (
    <main className="screen">
      <header className="row between">
        <h1 className="brand small">Smallbird</h1>
        <button className="link" onClick={onSignOut}>
          Sign out
        </button>
      </header>
      <p className="muted">
        {email}
        {entitlement && ` · ${Math.floor(entitlement.remainingMinutes)} min left`}
      </p>
      {entitlementError && <p className="error">{entitlementError}</p>}
      {outOfMinutes && <p className="error">You're out of minutes. Add more at smallbird.in to start an interview.</p>}

      <label>
        Company
        <input value={profile.company} onChange={(e) => update({ company: e.target.value })} placeholder="e.g. Google" />
      </label>
      <label>
        Role
        <input value={profile.role} onChange={(e) => update({ role: e.target.value })} placeholder="e.g. Senior Backend Engineer" />
      </label>
      <label>
        Your background
        <textarea
          rows={8}
          value={profile.background}
          onChange={(e) => update({ background: e.target.value })}
          placeholder="Paste your resume and the job description here. Answers will use your real projects and skills."
        />
      </label>
      <label className="file">
        Or load a .txt / .md file
        <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={loadTextFile} />
      </label>

      <button className="primary" onClick={onContinue} disabled={outOfMinutes}>
        Test microphone
      </button>
    </main>
  );
}
