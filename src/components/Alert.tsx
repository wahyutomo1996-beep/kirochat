interface Props {
  type?: 'success' | 'error' | 'info' | 'warning';
  children: React.ReactNode;
}

const styles = {
  success: 'bg-green-500/10 border-green-500/30 text-green-400',
  error: 'bg-red-500/10 border-red-500/30 text-red-400',
  info: 'bg-surface-1 border-edge text-txt-secondary',
  warning: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400',
};

export function Alert({ type = 'info', children }: Props) {
  return (
    <div className={`px-3.5 py-2.5 rounded-lg border text-xs ${styles[type]}`}>
      {children}
    </div>
  );
}
