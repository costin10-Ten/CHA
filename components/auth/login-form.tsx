"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  sendMagicLinkAction,
  signInAction,
  signUpAction,
} from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthActionResult } from "@/lib/auth/schema";

type Mode = "sign-in" | "sign-up" | "magic-link";

const initialState: AuthActionResult = { status: "idle" };

const MODE_LABEL: Record<Mode, string> = {
  "sign-in": "登入",
  "sign-up": "註冊",
  "magic-link": "寄送登入連結",
};

function SubmitButton({ mode }: { mode: Mode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "處理中…" : MODE_LABEL[mode]}
    </Button>
  );
}

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const [mode, setMode] = useState<Mode>("sign-in");

  const action =
    mode === "sign-in"
      ? signInAction
      : mode === "sign-up"
        ? signUpAction
        : sendMagicLinkAction;

  const [state, formAction] = useActionState(action, initialState);

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="登入方式"
        className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1"
      >
        {(Object.keys(MODE_LABEL) as Mode[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={`rounded px-2 py-1.5 text-sm font-medium transition-colors ${
              mode === value
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {value === "magic-link" ? "登入連結" : MODE_LABEL[value]}
          </button>
        ))}
      </div>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="redirectTo" value={redirectTo} />

        <div className="space-y-2">
          <Label htmlFor="email">電子郵件</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
          />
        </div>

        {mode !== "magic-link" && (
          <div className="space-y-2">
            <Label htmlFor="password">密碼</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={
                mode === "sign-up" ? "new-password" : "current-password"
              }
              required
              minLength={8}
              placeholder="至少 8 個字元"
            />
          </div>
        )}

        <SubmitButton mode={mode} />
      </form>

      {state.status === "error" && (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="text-sm text-emerald-700">
          {state.message}
        </p>
      )}
    </div>
  );
}
