import type { ComponentType, SVGProps } from "react";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CircleIcon,
  ClockIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";
import { STATUS_LABELS, type AttemptStatus } from "@/lib/tracker/enums";

export type StatusTone = "danger" | "warning" | "success" | "neutral";

const TONES: Record<
  StatusTone,
  { wrap: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  danger: {
    wrap: "bg-danger-soft text-danger",
    Icon: AlertTriangleIcon,
  },
  warning: {
    wrap: "bg-warning-soft text-warning",
    Icon: ClockIcon,
  },
  success: {
    wrap: "bg-brand-soft text-brand-deep",
    Icon: CheckCircleIcon,
  },
  neutral: {
    wrap: "bg-muted text-muted-foreground",
    Icon: CircleIcon,
  },
};

export function getStatusTone(status: AttemptStatus): StatusTone {
  switch (status) {
    case "admit_card":
    case "failed":
      return "danger";
    case "tracking":
    case "applied":
    case "appeared":
      return "warning";
    case "passed":
      return "success";
    case "withdrawn":
    default:
      return "neutral";
  }
}

export function StatusBadge({
  tone,
  status,
  children,
  className,
}: {
  tone?: StatusTone;
  status?: AttemptStatus;
  children?: React.ReactNode;
  className?: string;
}) {
  const resolvedTone = tone ?? (status ? getStatusTone(status) : "neutral");
  const { wrap, Icon } = TONES[resolvedTone];
  const label = children ?? (status ? STATUS_LABELS[status] : null);

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold shrink-0",
        wrap,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {label ? <span className="truncate">{label}</span> : null}
    </span>
  );
}
