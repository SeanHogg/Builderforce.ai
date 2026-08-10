import type { HTMLAttributes, ReactNode } from 'react';

export function PageHeader({ eyebrow, title, description, actions, className, ...props }: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <header {...props} className={`ui-page-header${className ? ` ${className}` : ''}`}>
      <div className="ui-page-header__copy">
        {eyebrow && <div className="ui-page-header__eyebrow">{eyebrow}</div>}
        <h1 className="ui-page-header__title">{title}</h1>
        {description && <p className="ui-page-header__description">{description}</p>}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  );
}
