import Link, { type LinkProps } from 'next/link';
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

type SharedButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
};

function buttonClassName({ variant = 'secondary', size = 'md', block = false }: SharedButtonProps, className?: string) {
  return [
    'ui-button',
    `ui-button--${variant}`,
    // `md` is the default size and is carried by the base `.ui-button` rule
    // (min-height: var(--control-md)) — there is no `.ui-button--md`. Emitting
    // one would ship a class with no rule and invite hand-written copies of it.
    size === 'md' ? '' : `ui-button--${size}`,
    block ? 'ui-button--block' : '',
    className ?? '',
  ].filter(Boolean).join(' ');
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & SharedButtonProps>(
  function Button({ variant, size, block, loading = false, className, disabled, children, ...props }, ref) {
    return (
      <button
        {...props}
        ref={ref}
        className={buttonClassName({ variant, size, block }, className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
      >
        {loading && <span className="ui-button__spinner" aria-hidden="true" />}
        {children}
      </button>
    );
  },
);

type ButtonLinkProps = LinkProps
  & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps>
  & SharedButtonProps
  & { children: ReactNode };

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  function ButtonLink({ variant, size, block, className, children, ...props }, ref) {
    return <Link {...props} ref={ref} className={buttonClassName({ variant, size, block }, className)}>{children}</Link>;
  },
);
