import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

type FieldFrameProps = {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: ReactNode;
  children: ReactNode;
};

export function FieldFrame({ id, label, hint, error, optional, children }: FieldFrameProps) {
  const descriptionId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={`ui-field${error ? ' ui-field--error' : ''}`}>
      <div className="ui-field__label-row">
        <label className="ui-field__label" htmlFor={id}>{label}</label>
        {optional && <span className="ui-field__optional">{optional}</span>}
      </div>
      {children}
      {error
        ? <div className="ui-field__message ui-field__message--error" id={descriptionId} role="alert">{error}</div>
        : hint && <div className="ui-field__message" id={descriptionId}>{hint}</div>}
    </div>
  );
}

export const TextField = forwardRef<HTMLInputElement, Omit<FieldFrameProps, 'children'> & InputHTMLAttributes<HTMLInputElement>>(
  function TextField({ id, label, hint, error, optional, className, ...props }, ref) {
    const descriptionId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
    return (
      <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional}>
        <input {...props} id={id} ref={ref} className={`ui-input${className ? ` ${className}` : ''}`} aria-invalid={Boolean(error) || undefined} aria-describedby={descriptionId} />
      </FieldFrame>
    );
  },
);

export const TextAreaField = forwardRef<HTMLTextAreaElement, Omit<FieldFrameProps, 'children'> & TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextAreaField({ id, label, hint, error, optional, className, ...props }, ref) {
    const descriptionId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
    return (
      <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional}>
        <textarea {...props} id={id} ref={ref} className={`ui-input ui-textarea${className ? ` ${className}` : ''}`} aria-invalid={Boolean(error) || undefined} aria-describedby={descriptionId} />
      </FieldFrame>
    );
  },
);
