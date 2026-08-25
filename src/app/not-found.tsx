import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="cond text-[11px] font-bold tracking-[0.15em] text-ink-3 uppercase">404</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
        That page does not exist
      </h1>
      <p className="mt-2 text-ink-2">It may have moved, or the link may be out of date.</p>
      <Link
        href="/"
        className="mt-6 text-sm font-medium text-accent underline-offset-4 hover:underline"
      >
        Back to home
      </Link>
    </main>
  );
}
