import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const CONTROL_CLASSES =
  'block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-slate-300 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-600 disabled:bg-slate-100 disabled:text-slate-500';

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-800">
        {label}
        {required ? (
          <span className="ml-0.5 text-rose-600" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs font-medium text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export function TextInput({
  label,
  hint,
  error,
  containerClassName = '',
  id,
  required,
  ...rest
}: TextInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={containerClassName}>
      <Field label={label} htmlFor={inputId} hint={hint} error={error} required={required}>
        <input
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? `${inputId}-description` : undefined}
          className={CONTROL_CLASSES}
          {...rest}
        />
      </Field>
    </div>
  );
}

export interface TextAreaInputProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextAreaInput({ label, hint, error, id, required, ...rest }: TextAreaInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} required={required}>
      <textarea
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${inputId}-description` : undefined}
        className={CONTROL_CLASSES}
        {...rest}
      />
    </Field>
  );
}

export interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

export function SelectInput({
  label,
  hint,
  error,
  options,
  id,
  required,
  ...rest
}: SelectInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} required={required}>
      <select
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={CONTROL_CLASSES}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
