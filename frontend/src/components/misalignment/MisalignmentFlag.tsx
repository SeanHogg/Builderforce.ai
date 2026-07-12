import { Badge, Tooltip, type TooltipContentProps } from '@repo/ui';
import { AlertTriangle, Info } from 'lucide-react';
import { formatExplanation, getExplanationHint, type TaskMisalignmentCheck } from '@/lib/misalignment';

interface MisalignmentFlagProps {
  checks: TaskMisalignmentCheck[];
  severity: 'warning' | 'error';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

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
    if (checks.length === 0) return null;

    // Show the first check's explanation
    const firstCheck = checks[0];
    const explanation = formatExplanation(firstCheck);
    const hint = getExplanationHint(firstCheck);

    return (
      <div className="flex max-w-sm flex-col items-start gap-0.5 text-xs">
        <span>{explanation}</span>
        {hint && (
          <span className="text-muted-foreground mt-1">
            {hint}
          </span>
        )}
        {hasMultipleChecks && (
          <span className="ml-1">
            (+{checks.length - 1} {t('moreChecks')})
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