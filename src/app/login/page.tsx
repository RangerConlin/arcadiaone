import { redirect } from "next/navigation";
import { login } from "@/lib/auth/actions";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { inputClass, Notice, SubmitButton } from "@/components/ui";
export const dynamic = "force-dynamic";
export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  if (await getAuthenticatedUser()) redirect("/");
  const query = await searchParams;
  return <main className="flex min-h-screen items-center justify-center bg-[color:var(--background)] px-4">
    <section className="w-full max-w-md rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-8 shadow-xl">
      <p className="text-sm font-semibold text-[color:var(--accent)]">Arcadia Command Solutions</p>
      <h1 className="mt-2 text-3xl font-semibold">Sign in to ArcadiaOne</h1>
      <p className="mt-2 text-sm text-[color:var(--muted)]">Use your organization account to continue.</p>
      <form action={login} className="mt-8 grid gap-5">
        <Notice message={query?.error} tone="error" />
        <label className="grid gap-2 text-sm font-medium">Email<input autoComplete="username" className={inputClass} name="email" required type="email" /></label>
        <label className="grid gap-2 text-sm font-medium">Password<input autoComplete="current-password" className={inputClass} name="password" required type="password" /></label>
        <SubmitButton>Sign In</SubmitButton>
      </form>
    </section>
  </main>;
}
