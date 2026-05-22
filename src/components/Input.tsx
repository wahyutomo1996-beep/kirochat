import { InputHTMLAttributes, forwardRef } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, Props>(
  ({ label, error, hint, className = '', ...props }, ref) => {
    return (
      <div>
        {label && (
          <label className="block text-[11px] font-semibold text-txt-muted mb-1.5 uppercase tracking-wider">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`w-full px-3.5 py-2.5 bg-surface-1 border rounded-lg text-white text-sm placeholder:text-txt-ghost focus:outline-none focus:ring-1 transition-all ${
            error
              ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/30'
              : 'border-edge focus:border-edge-hover focus:ring-edge-hover/40'
          } ${className}`}
          {...props}
        />
        {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
        {hint && !error && <p className="text-[11px] text-txt-faint mt-1">{hint}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';
