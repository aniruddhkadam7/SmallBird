export function Unauthorized() {
  return (
    <div className="card max-w-md">
      <h1 className="text-base font-semibold text-danger">Not authorized</h1>
      <p className="mt-2 text-sm text-muted">
        Your Supabase account is signed in, but it isn&apos;t on the admin allowlist. If you believe this is a
        mistake, ask an existing admin to add your account to <code className="text-xs">admin_users</code>.
      </p>
    </div>
  );
}
