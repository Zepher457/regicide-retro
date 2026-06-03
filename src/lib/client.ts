import { getBrowserSupabaseClient } from "@/lib/supabase";

const CLIENT_ID_KEY = "regicide-retro.client-id";

export function getClientId() {
  if (typeof window === "undefined") return "server";
  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const generated = `client_${crypto.randomUUID()}`;
  window.localStorage.setItem(CLIENT_ID_KEY, generated);
  return generated;
}

export function getBrowserRealtimeClient() {
  return getBrowserSupabaseClient();
}

export async function fetchJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `Request failed with ${response.status}`);
  }
  return json;
}
