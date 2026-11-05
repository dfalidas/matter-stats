"use server";
import { revalidatePath } from "next/cache";
import { requireAccessSession } from "@/lib/require-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { mutateReadingGoal, type GoalActionState } from "@/lib/reading-goals-service";

export async function saveReadingGoal(previous: GoalActionState, form: FormData): Promise<GoalActionState> {
  void previous;
  return mutateReadingGoal({ authorize: requireAccessSession, client: getSupabaseAdminClient, now: () => new Date(), refresh: () => revalidatePath("/dashboard") }, form);
}
