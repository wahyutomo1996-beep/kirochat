import { ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'xs' | 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  // Primary = Linear lavender CTA. Single chromatic accent across the app.
  primary: 'bg-accent text-white hover:bg-accent-hover active:bg-accent-focus shadow-accent',
  secondary: 'bg-surface-1 border border-hairline text-ink hover:border-hairline-strong hover:bg-surface-2',
  ghost: 'text-ink-subtle hover:text-ink hover:bg-surface-1',
  danger: 'bg-surface-1 border border-hairline text-ink-subtle hover:text-red-400 hover:border-red-500/50',
  outline: 'border border-hairline text-ink hover:border-hairline-strong hover:bg-surface-1',
};

const sizes: Record<Size, string> = {
  xs: 'px-2.5 py-1 text-xs',
  sm: 'px-3 py-1.5 text-sm',  // Linear button-sm is 14px / weight 500
  md: 'px-3.5 py-2 text-sm',  // Linear compact spec: 8px·14px padding
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'primary', size = 'md', loading, children, className = '', disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {loading ? (
          <>
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Loading
          </>
        ) : children}
      </button>
    );
  }
);
Button.displayName = 'Button';
