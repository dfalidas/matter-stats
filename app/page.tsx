import { redirect } from "next/navigation";
import type { Route } from "next";

export default async function Home({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams ?? {})) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, entry);
  }
  redirect(`/dashboard${params.size ? `?${params}` : ""}` as Route);
}
