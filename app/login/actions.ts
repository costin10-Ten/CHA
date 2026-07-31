"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  credentialsSchema,
  magicLinkSchema,
  toFriendlyAuthError,
  type AuthActionResult,
} from "@/lib/auth/schema";
import { getAppUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

function safeRedirectTo(value: FormDataEntryValue | null): string {
  const raw = typeof value === "string" ? value : "";
  // 只接受站內相對路徑，避免 open redirect。
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/dashboard";
}

export async function signInAction(
  _prev: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { status: "error", message: toFriendlyAuthError(error.message) };
  }

  revalidatePath("/", "layout");
  redirect(safeRedirectTo(formData.get("redirectTo")));
}

export async function signUpAction(
  _prev: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${getAppUrl()}/auth/callback` },
  });

  if (error) {
    return { status: "error", message: toFriendlyAuthError(error.message) };
  }

  // 已開啟 email 驗證時 session 為 null，需要使用者收信確認。
  if (!data.session) {
    return {
      status: "success",
      message: "註冊完成，請到信箱點擊確認連結後再登入。",
    };
  }

  revalidatePath("/", "layout");
  redirect(safeRedirectTo(formData.get("redirectTo")));
}

export async function sendMagicLinkAction(
  _prev: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const parsed = magicLinkSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const redirectTo = safeRedirectTo(formData.get("redirectTo"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${getAppUrl()}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
    },
  });

  if (error) {
    return { status: "error", message: toFriendlyAuthError(error.message) };
  }

  return { status: "success", message: "登入連結已寄出，請到信箱點擊完成登入。" };
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
