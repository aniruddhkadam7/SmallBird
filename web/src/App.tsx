import { useState } from "react";
import Live from "./Live";
import Login from "./Login";
import MicCheck from "./MicCheck";
import Setup, { loadProfile } from "./Setup";
import Summary from "./Summary";
import { loadSession, signOut, type AuthSession } from "./session";
import type { SessionResult } from "./types";

type Screen = "setup" | "mic" | "live" | "summary";

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(loadSession);
  const [screen, setScreen] = useState<Screen>("setup");
  const [profile, setProfile] = useState(loadProfile);
  const [result, setResult] = useState<SessionResult | null>(null);

  if (!session) return <Login onSignedIn={setSession} />;

  switch (screen) {
    case "mic":
      return <MicCheck onReady={() => setScreen("live")} onBack={() => setScreen("setup")} />;
    case "live":
      return (
        <Live
          profile={profile}
          onCancel={() => setScreen("mic")}
          onFinished={(finished) => {
            setResult(finished);
            setScreen("summary");
          }}
        />
      );
    case "summary":
      return result ? <Summary result={result} onDone={() => setScreen("setup")} /> : null;
    default:
      return (
        <Setup
          email={session.email}
          profile={profile}
          onProfile={setProfile}
          onContinue={() => setScreen("mic")}
          onSignOut={() => {
            signOut();
            setSession(null);
          }}
        />
      );
  }
}
