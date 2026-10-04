export async function authorizeAccessSession(deps: {
  readToken: () => Promise<string | undefined>;
  validateToken: (token: string | undefined) => Promise<boolean>;
}): Promise<boolean> {
  try {
    return await deps.validateToken(await deps.readToken());
  } catch {
    return false;
  }
}
