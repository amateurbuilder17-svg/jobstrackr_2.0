const MODULES = [
  { id: "M0", name: "Foundation & guardrails", state: "active" },
  { id: "M1", name: "Data platform", state: "blocked" },
  { id: "M2", name: "Data access layer", state: "todo" },
  { id: "M3", name: "Design system & shell", state: "todo" },
  { id: "M4", name: "Jobs — list, search, filters", state: "todo" },
  { id: "M5", name: "Job detail & SEO", state: "todo" },
  { id: "M6", name: "Auth & profile", state: "todo" },
  { id: "M7", name: "Saved & tracker", state: "todo" },
  { id: "M8", name: "For You — server-side matching", state: "todo" },
  { id: "M9", name: "Exam updates & calendar", state: "todo" },
  { id: "M10", name: "Admin", state: "todo" },
  { id: "M11", name: "Ingestion pipeline", state: "todo" },
  { id: "M12", name: "Observability & cutover", state: "todo" },
] as const;

const STATE_STYLE: Record<string, string> = {
  active: "text-accent",
  blocked: "text-warn",
  todo: "text-ink-3",
};

const STATE_LABEL: Record<string, string> = {
  active: "in progress",
  blocked: "needs Supabase project",
  todo: "",
};

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-accent">
        Scaffold running
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink">JobsTrackr</h1>
      <p className="mt-3 text-ink-2">
        Rebuild in progress. This placeholder exists to prove the toolchain builds and deploys;
        it is replaced in Module 3.
      </p>

      <ol className="mt-12 divide-y divide-line border-y border-line">
        {MODULES.map((m) => (
          <li key={m.id} className="flex items-baseline gap-4 py-3">
            <span className="w-9 shrink-0 font-mono text-xs tabular-nums text-ink-3">
              {m.id}
            </span>
            <span className={`flex-1 text-sm ${STATE_STYLE[m.state] ?? ""}`}>{m.name}</span>
            {STATE_LABEL[m.state] ? (
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                {STATE_LABEL[m.state]}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </main>
  );
}
