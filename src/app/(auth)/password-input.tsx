"use client";

import { clsx } from "clsx";
import { useState } from "react";

import { ariaFor, LockIcon } from "./auth-ui";
import styles from "./auth.module.css";

/**
 * A password field with a reveal control.
 *
 * The one piece of state on these screens, and it earns its ~0.3 kB: most of
 * this audience signs in on a mid-range Android phone, where a mistyped
 * password behind eight dots is a failed sign-in with no way to see why. The
 * alternative — no reveal — makes the browser's own password manager the only
 * recovery path, and a large share of these accounts were created on a shared
 * device without one.
 *
 * `type` is swapped rather than a second hidden input being toggled, so there
 * is exactly one control with one name and the form data cannot depend on
 * which state the button was left in.
 *
 * Note what is *not* here: no value state. The input stays uncontrolled, so
 * every keystroke is the browser's business rather than a React render, and
 * the field behaves identically if hydration is slow or never happens — the
 * form still posts, and only the reveal button is inert.
 */
export function PasswordInput({
  id,
  autoComplete,
  placeholder,
  error,
  hint,
}: {
  id: string;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <input
        id={id}
        name={id}
        type={visible ? "text" : "password"}
        required
        autoComplete={autoComplete}
        placeholder={placeholder ?? "••••••••"}
        className={clsx(styles.input, styles.inputWithAction)}
        {...ariaFor(id, error, hint)}
      />
      <span className={styles.icon} aria-hidden>
        <LockIcon />
      </span>

      <button
        type="button"
        className={styles.reveal}
        onClick={() => {
          setVisible((v) => !v);
        }}
        // The visible word already says "Show"/"Hide", but it does not say
        // what of — and a screen reader lands on this button with no idea it
        // belongs to the field beside it.
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
        <span>{visible ? "Hide" : "Show"}</span>
      </button>
    </>
  );
}

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function EyeIcon() {
  return (
    <svg className={styles.revealIcon} viewBox="0 0 24 24" {...STROKE} aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className={styles.revealIcon} viewBox="0 0 24 24" {...STROKE} aria-hidden>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
