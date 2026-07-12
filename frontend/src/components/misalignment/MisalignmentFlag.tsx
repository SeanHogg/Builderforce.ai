import { Badge, Tooltip, type TooltipContentProps } from '@repo/ui';
import { AlertTriangle, Info } from 'lucide-react';
import {
  priorityLabels,
  type TaskMisalignmentCheck,
} from '@/lib/misalignment';

interface MisalignmentFlagProps {
  checks: TaskMisalignmentCheck[];
  severity: 'warning' | 'error';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeVariants = {
  sm: 'h-5 w-5',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
};

/**
 * MisalignmentFlag — a compact indicator that uses severity-based color/icons
 * and a tooltip to show why the task is flagged.
 */
export const MisalignmentFlag = ({
  checks,
  severity,
  className,
  size = 'sm',
}: MisalignmentFlagProps) => {
  const icon =
    severity === 'warning' ? (
      <Info className={sizeVariants[size]} />
    ) : (
      <AlertTriangle className={sizeVariants[size]} />
    );

  const color =
    severity === 'warning' ? 'text-orange-500' : 'text-red-500';

  const hasMultipleChecks = checks.length > 1;
  const Explainer = (() => {
    const first = checks[0];
    if (!first) return null;
    return (
      <div className="flex max-w-sm flex-col items-start gap-0.5 text-xs">
        {first.i18n?.mechanism || 'Priority misalignment detected'}
        {first.detachedReason && first.detachedReason !== 'N/A' && (
          <span className="text-muted-foreground">
            ({first.detachedReason})
          </span>
        )}
        {hasMultipleChecks && (
          <span className="text-muted-foreground">
            +{checks.length - 1} more
          </span>
        )}
      </div>
    );
  })();

  return (
    <Tooltip content={Explainer as TooltipContentProps} delayDuration={600}>
      <Badge
        variant={severity === 'warning' ? 'outline' : 'default'}
        className={`${color} ${size === 'sm' ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-1 text-xs'} ${className}`}
      >
        <span className="mr-1">{icon}</span>
        {priorityLabels[severity] ?? severity}
      </Badge>
    </Tooltip>
  );
};