import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  APP_ACCESS_PASSWORD: z.string().min(1).optional(),
  MATTER_API_TOKEN: z.string().min(1).optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
});

export function getServerEnv() {
  return serverEnvSchema.parse(process.env);
}
