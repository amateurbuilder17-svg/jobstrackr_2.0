import type { SVGProps } from "react";

export interface NavIconProps extends SVGProps<SVGSVGElement> {
  active?: boolean;
}

/**
 * Custom bespoke navigation icons matching user designs:
 * 1. Home - Solid home with arched door cutout
 * 2. Jobs - Bold search glass with thick rounded handle
 * 3. Updates - Full flame silhouette with inner flame cutout (not clipped)
 * 4. My Exams - Document with lines and checkmark badge
 * 5. Calendar - Calendar with binder rings, dot grid and clock badge
 */

export function HomeNavIcon({ active: _active, ...props }: NavIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2.2a2.4 2.4 0 0 0-1.65.65L2.9 9.85A2.6 2.6 0 0 0 2 11.75V19a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-7.25a2.6 2.6 0 0 0-.9-1.9L13.65 2.85A2.4 2.4 0 0 0 12 2.2Zm-2.5 19.8V15.2a2.5 2.5 0 0 1 5 0V22h-5Z"
      />
    </svg>
  );
}

export function JobsNavIcon({ active: _active, ...props }: NavIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.5 3a7.5 7.5 0 1 0 4.67 13.37l4.73 4.73a1.5 1.5 0 0 0 2.12-2.12l-4.73-4.73A7.5 7.5 0 0 0 10.5 3Zm-4.5 7.5a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0Z"
      />
    </svg>
  );
}

export function UpdatesNavIcon({ active: _active, ...props }: NavIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2.2c.4 1.8 1.4 3.5 2.6 5 1.3 1.6 2.4 3.2 2.4 5.3 0 1.3-.4 2.5-1.2 3.5 1.3-1 2.2-2.6 2.2-4.5 1.6 1.7 2.6 3.9 2.6 6.4 0 4.6-3.8 8.3-8.6 8.3S3.4 22.5 3.4 18c0-3.6 2-6.8 5-8.2.3 1.7 1.2 3.2 2.5 4.1.8-2.6 1.1-6.8 1.1-11.7Zm0 11.6c-.4 1.7-1.4 3.1-2.7 4.1 1.6 1.2 3.8.9 5.1-.5.4-.5.7-1.2.7-2 0-1.6-1-3.2-2.1-4.4-.3 1-.7 1.9-1 2.8Z"
      />
    </svg>
  );
}

export function TrackerNavIcon({ active: _active, ...props }: NavIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M14.5 2H6.5A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h5" />
      <path d="M14.5 2A2.5 2.5 0 0 1 17 4.5V11" />
      <path d="M8 6.5h5.5" />
      <path d="M8 10.5h6" />
      <path d="M8 14.5h3" />
      <circle
        cx="17.5"
        cy="17.5"
        r="4.5"
        fill="var(--nav-surface, #ffffff)"
        strokeWidth={2.2}
      />
      <path d="m15.5 17.5 1.5 1.5 2.5-2.5" strokeWidth={2.2} />
    </svg>
  );
}

export function CalendarNavIcon({ active: _active, ...props }: NavIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 8.5V19a2.5 2.5 0 0 0 2.5 2.5h5.5" />
      <path d="M4 8.5h16V11" />
      <path d="M6.5 4.5H17.5A2.5 2.5 0 0 1 20 7v1.5" />
      <path d="M4 7a2.5 2.5 0 0 1 2.5-2.5" />
      <path d="M7 2.5v3M12 2.5v3M17 2.5v3" />
      <circle cx="8" cy="12.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="8" cy="16.5" r="0.8" fill="currentColor" stroke="none" />
      <circle
        cx="17.5"
        cy="17.5"
        r="4.5"
        fill="var(--nav-surface, #ffffff)"
        strokeWidth={2.2}
      />
      <path d="M17.5 15v2.5h2" strokeWidth={2.2} />
    </svg>
  );
}
