import { LoginForm } from "@/components/login-form";

export default async function LoginPage({ searchParams: pendingParams }: { searchParams: Promise<{ reason?: string }> }) {
  const searchParams = await pendingParams;
  const message = searchParams.reason === "expired" ? "Your session expired. Sign in again to continue."
    : searchParams.reason === "signed-out" ? "You’ve been signed out. Sign in to continue."
    : "Sign in to access your financial workspace.";
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div>
          <h1 className="section-title">Sign in</h1>
          <p className="section-subtitle">
            {message}
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
