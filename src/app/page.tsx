export default function Home() {
  return (
    <main className="min-h-screen px-6 py-10 sm:px-10">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center">
        <div className="w-full border-y border-[color:var(--border)] py-12 sm:py-16">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">
            Application online
          </p>
          <h1 className="text-4xl font-semibold tracking-normal text-[color:var(--foreground)] sm:text-6xl">
            ArcadiaOne
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[color:var(--muted)] sm:text-xl">
            Employee and project management platform for Arcadia Command
            Solutions.
          </p>
          <div className="mt-8 inline-flex items-center gap-3 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3 text-sm font-medium text-[color:var(--foreground)]">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            Deployment validation page is running.
          </div>
        </div>
      </section>
    </main>
  );
}
