import { NextResponse } from "next/server";
import { getAdminSupabaseClient, getBrowserSupabaseClient } from "@/lib/supabase";

export async function GET() {
  return NextResponse.json({
    publicConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    serverConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    browserClientAvailable: Boolean(getBrowserSupabaseClient()),
    adminClientAvailable: Boolean(getAdminSupabaseClient()),
  });
}
