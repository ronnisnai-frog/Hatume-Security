"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) {
      setLoading(false);
      setError(signInErr.message);
      return;
    }

    // Check whether this account has two-factor enabled and still needs the code
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      setNeedsCode(true);
      setLoading(false);
      return;
    }

    setLoading(false);
    router.push("/dashboard");
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data: factors, error: factorsErr } = await supabase.auth.mfa.listFactors();
    if (factorsErr || !factors?.totp?.[0]) {
      setLoading(false);
      setError("Couldn't find your two-factor setup. Try signing in again.");
      return;
    }
    const factorId = factors.totp[0].id;

    const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeErr || !challenge) {
      setLoading(false);
      setError(challengeErr?.message || "Couldn't start the verification step.");
      return;
    }

    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    setLoading(false);
    if (verifyErr) {
      setError("That code didn't work — check your authenticator app and try again.");
      return;
    }
    router.push("/dashboard");
  }

  if (needsCode) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <form onSubmit={handleVerifyCode} className="w-full max-w-sm bg-surface border border-border rounded-lg p-8">
          <p className="font-mono text-xs text-accent tracking-wide mb-1">Hatume Security</p>
          <h1 className="text-xl font-semibold text-text-primary mb-2">Enter your 6-digit code</h1>
          <p className="text-text-secondary text-sm mb-6">Open your authenticator app to get the current code.</p>

          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            required
            maxLength={6}
            className="w-full mb-6 bg-bg border border-border rounded-md px-3 py-2 text-text-primary text-center tracking-[0.4em] text-lg focus:outline-none focus:ring-2 focus:ring-accent"
          />

          {error && <p className="text-danger text-sm mb-4">{error}</p>}

          <button
            type="submit"
            disabled={loading || code.length < 6}
            className="w-full bg-accent text-bg font-medium rounded-md py-2 hover:opacity-90 transition disabled:opacity-50"
          >
            {loading ? "Verifying…" : "Verify"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleLogin} className="w-full max-w-sm bg-surface border border-border rounded-lg p-8">
        <p className="font-mono text-xs text-accent tracking-wide mb-1">Hatume Security</p>
        <h1 className="text-xl font-semibold text-text-primary mb-6">Guard monitor sign in</h1>

        <label className="block text-sm text-text-secondary mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full mb-4 bg-bg border border-border rounded-md px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
        />

        <label className="block text-sm text-text-secondary mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full mb-6 bg-bg border border-border rounded-md px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
        />

        {error && <p className="text-danger text-sm mb-4">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-accent text-bg font-medium rounded-md py-2 hover:opacity-90 transition disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
