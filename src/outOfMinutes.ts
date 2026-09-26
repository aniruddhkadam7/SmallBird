// Messages that mean the user's minutes are used up — from the server
// (session-heartbeat, stt-token, the AI proxies) or the overlay's own
// countdown. They get an "Upgrade" button next to them.
export function isOutOfMinutesMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return /used all your minutes|out of minutes/i.test(message);
}
