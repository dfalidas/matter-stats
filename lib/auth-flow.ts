export const LOGIN_UNAVAILABLE_MESSAGE = "Sign-in is temporarily unavailable. Please try again later.";

type LoginState = { error?: string };

export type LoginFlowDeps = {
  passwordIsCorrect: () => boolean;
  recordAttempt: (succeeded: boolean) => Promise<boolean>;
  createSession: () => Promise<string>;
  issueCookie: (token: string) => Promise<void>;
  diagnose: (reason: "limiter_unavailable" | "session_storage_unavailable") => void;
};

export async function runLoginFlow(deps: LoginFlowDeps): Promise<LoginState | null> {
  let passwordIsCorrect: boolean;
  try {
    passwordIsCorrect = deps.passwordIsCorrect();
  } catch {
    deps.diagnose("session_storage_unavailable");
    return { error: LOGIN_UNAVAILABLE_MESSAGE };
  }

  let allowed: boolean;
  try {
    allowed = await deps.recordAttempt(passwordIsCorrect);
  } catch {
    deps.diagnose("limiter_unavailable");
    return { error: LOGIN_UNAVAILABLE_MESSAGE };
  }
  if (!allowed) return { error: "Too many attempts. Please wait 15 minutes and try again." };
  if (!passwordIsCorrect) return { error: "Invalid password. Please try again." };

  try {
    const token = await deps.createSession();
    await deps.issueCookie(token);
  } catch {
    deps.diagnose("session_storage_unavailable");
    return { error: LOGIN_UNAVAILABLE_MESSAGE };
  }
  return null;
}
