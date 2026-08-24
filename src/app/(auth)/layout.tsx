import type { ReactNode } from "react";

/**
 * A narrow, centred column for the four credential screens.
 *
 * These pages are the one place in the app where a person is doing exactly one
 * thing, so everything competing for attention is removed rather than merely
 * de-emphasised.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col justify-center px-4 py-10 sm:py-16">
      {children}
    </div>
  );
}
