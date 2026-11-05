import type { Metadata } from "next"
import { UnsubscribeButton } from "./unsubscribe-button"

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
}

// Landing page for the "Unsubscribe" link in SmallBird AI marketing emails.
// The link is signed (see the unsubscribe Edge Function); the button below
// posts it back there. Nothing happens until the button is pressed, so mail
// scanners that open links can't unsubscribe anyone by accident.
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ u?: string; t?: string }> }) {
  const { u, t } = await searchParams
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Unsubscribe from SmallBird AI emails</h1>
      {u && t ? (
        <UnsubscribeButton userId={u} token={t} />
      ) : (
        <p className="max-w-sm text-sm text-muted-foreground">
          This unsubscribe link looks incomplete. Please use the link from the email, or write to support@smallbirdai.com
          and we&apos;ll remove you.
        </p>
      )}
    </main>
  )
}
