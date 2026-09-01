import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Form field primitives.
 *
 * The wiring these share is the accessibility contract: a label bound to its
 * control by id, the error text referenced by `aria-describedby`, and
 * `aria-invalid` set when there is a message. Done per-form by hand it gets
 * skipped under deadline; done here it is simply how a field is built.
 */

const CONTROL = [
  "w-full rounded-md border border-line bg-surface px-3 text-base text-ink",
  "placeholder:text-ink-3",
  "transition-[border-color,box-shadow] duration-(--duration-fast)",
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
  "disabled:cursor-not-allowed disabled:opacity-60",
  "aria-[invalid=true]:border-critical aria-[invalid=true]:ring-critical/25",
].join(" ");

export interface FieldProps {
  id: string;
  label: string;
  // `| undefined` spelled out on every optional prop below because the project
  // compiles with `exactOptionalPropertyTypes`. Under that flag `error?: string`
  // means "absent, or a string" — passing an explicit `undefined`, which is what
  // `state.errors?.email` evaluates to, is a type error. The alternative is a
  // conditional spread at all ~40 call sites.
  error?: string | undefined;
  hint?: string | undefined;
  /** Renders the "Optional" affordance. Most fields here genuinely are. */
  optional?: boolean | undefined;
  children: ReactNode;
}

export function Field({ id, label, error, hint, optional, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-baseline gap-2 text-sm font-medium">
        <span className="text-ink">{label}</span>
        {optional ? <span className="text-xs text-ink-3">Optional</span> : null}
      </label>

      {children}

      {/* Hint is hidden once there is an error: two lines of small print under
          one input is noise at the moment the user most needs one clear
          instruction. */}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-critical" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Wires `aria-*` from the presence of an error, so callers cannot forget. */
function aria(id: string, error?: string, hint?: string) {
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  error?: string | undefined;
  hint?: string | undefined;
}

export function Input({ id, error, hint, className, ...props }: InputProps) {
  return (
    <input
      id={id}
      name={props.name ?? id}
      className={cn(CONTROL, "h-9.5", className)}
      {...aria(id, error, hint)}
      {...props}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  error?: string | undefined;
  hint?: string | undefined;
  placeholder?: string | undefined;
  options: readonly { value: string; label: string }[];
}

export function Select({
  id,
  error,
  hint,
  placeholder = "Select…",
  options,
  className,
  ...props
}: SelectProps) {
  return (
    <select
      id={id}
      name={props.name ?? id}
      className={cn(CONTROL, "h-9.5 text-base", className)}
      {...aria(id, error, hint)}
      {...props}
    >
      {/* Empty value, so an untouched select posts "" and the action maps it to
          null rather than storing the placeholder text. */}
      <option value="" className="text-base">
        {placeholder}
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value} className="text-base">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  error?: string | undefined;
  hint?: string | undefined;
}

export function Textarea({ id, error, hint, className, ...props }: TextareaProps) {
  return (
    <textarea
      id={id}
      name={props.name ?? id}
      className={cn(CONTROL, "min-h-20 py-2", className)}
      {...aria(id, error, hint)}
      {...props}
    />
  );
}

/**
 * A failure that belongs to the form rather than to any one field — a rejected
 * credential, an expired link. `role="alert"` so it is announced when it
 * appears, since it is usually the result of the action the user just took.
 */
export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical"
    >
      {children}
    </p>
  );
}

export function FormNotice({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="status"
      className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-ink"
    >
      {children}
    </p>
  );
}
