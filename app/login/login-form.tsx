"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

const initialState: LoginState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" className="w-full" disabled={pending}>{pending ? "Unlocking…" : "Unlock dashboard"}</Button>;
}

export function LoginForm() {
  const [state, formAction] = useActionState(login, initialState);

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <div>
        <label htmlFor="password" className="text-sm font-medium text-muted-foreground">App password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          className="mt-2 h-12 w-full rounded-2xl border border-border bg-muted/50 px-4 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary"
          placeholder="Enter APP_ACCESS_PASSWORD"
          required
        />
      </div>
      {state.error ? <p className="rounded-2xl border border-primary/30 bg-primary/10 p-3 text-sm text-primary">{state.error}</p> : null}
      <SubmitButton />
    </form>
  );
}
