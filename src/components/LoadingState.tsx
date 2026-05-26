interface Props {
  message?: string;
  fullScreen?: boolean;
}

export function LoadingState({ message = 'Loading...', fullScreen = false }: Props) {
  return (
    <div className={`flex items-center justify-center ${fullScreen ? 'min-h-screen' : 'py-12'}`}>
      <div className="flex flex-col items-center gap-3">
        <div className="flex gap-1.5">
          <div className="w-2 h-2 bg-accent rounded-full animate-pulse-dot"></div>
          <div className="w-2 h-2 bg-accent rounded-full animate-pulse-dot" style={{ animationDelay: '0.15s' }}></div>
          <div className="w-2 h-2 bg-accent rounded-full animate-pulse-dot" style={{ animationDelay: '0.3s' }}></div>
        </div>
        <p className="text-xs text-ink-subtle">{message}</p>
      </div>
    </div>
  );
}
