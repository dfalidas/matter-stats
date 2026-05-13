import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <section className="w-full max-w-md rounded-[2rem] border border-border bg-card/80 p-8 shadow-glow backdrop-blur">
        <div className="mb-8 inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-primary">Private MVP</div>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">Unlock Matter Stats</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">A single-user reading analytics dashboard protected by an HTTP-only app session cookie.</p>
        <LoginForm />
      </section>
    </main>
  );
}
