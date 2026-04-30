import Link from "next/link";

import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link className="back-link" href="/">
          Back to dashboard
        </Link>
        <div>
          <h1 className="section-title">Sign in</h1>
          <p className="section-subtitle">
            Use your local Django account to access the dashboard.
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
