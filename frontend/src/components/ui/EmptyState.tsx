import type { HTMLAttributes, ReactNode } from 'react';

export function EmptyState({ icon, title, description, actions, className, ...props }: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'title'>) {
  return (
    <div {...props} className={`ui-empty-state${className ? ` ${className}` : ''}`}>
      {icon && <div className="ui-empty-state__icon" aria-hidden="true">{icon}</div>}
      <h2 className="ui-empty-state__title">{title}</h2>
      {description && <p className="ui-empty-state__description">{description}</p>}
      {actions && <div className="ui-empty-state__actions">{actions}</div>}
    </div>
  );
}
