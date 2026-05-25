'use client';

/**
 * TradingPanel - side panel for the Trading workspace.
 *
 * Two stacked tools the trader actually uses while chatting with the AI:
 *
 *   1. TradingView chart (top)  — embeds TradingView's free widget.
 *      Auto-detects ticker mentions in chat ($BTC, $ETH, $TSLA, etc) and
 *      switches the chart symbol. User can also type a symbol manually.
 *
 *   2. Position calculator (bottom) — quick risk/reward computation.
 *      Inputs: entry price, stop loss, take profit, position size.
 *      Outputs: R:R ratio, % to TP, % to SL, dollar P&L on each side.
 *
 * Design intent:
 *   The AI tells you "BTC looks bullish at this S/R" — you immediately
 *   see the chart on the right, plug in your numbers in the calculator,
 *   make a decision without leaving the page.
 *
 * No external API calls, no auth needed. TradingView widget is a public
 * iframe-style embed — the most reliable free chart on the web.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

interface Props {
  messages: ChatMessage[];
}

/**
 * Detect tickers mentioned in chat content and rank them by:
 *   1. Most recent mention first
 *   2. Multiple mentions in same message > single
 *
 * Patterns recognized:
 *   $BTC                 → "BTC"
 *   $ETHUSD              → "ETHUSD"
 *   "Bitcoin"            → "BTC"  (a few common name aliases)
 *   "TSLA stock"         → "TSLA"
 *
 * Returns the most recent / most-mentioned symbol, or null if nothing matched.
 */
function detectTickerFromMessages(messages: ChatMessage[]): string | null {
  // Common name → symbol aliases. Loose matching, not exhaustive.
  const aliases: Record<string, string> = {
    bitcoin: 'BTCUSD',
    btc: 'BTCUSD',
    ethereum: 'ETHUSD',
    eth: 'ETHUSD',
    solana: 'SOLUSD',
    sol: 'SOLUSD',
    cardano: 'ADAUSD',
    dogecoin: 'DOGEUSD',
    tesla: 'TSLA',
    apple: 'AAPL',
    nvidia: 'NVDA',
    google: 'GOOGL',
    amazon: 'AMZN',
    microsoft: 'MSFT',
    meta: 'META',
  };

  // Walk newest-first so the most recent mention wins
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const lower = msg.content.toLowerCase();

    // Check $-prefixed tickers first (highest signal)
    const dollarMatch = msg.content.match(/\$([A-Z]{2,8})/);
    if (dollarMatch) return dollarMatch[1].toUpperCase();

    // Then check name aliases
    for (const [name, symbol] of Object.entries(aliases)) {
      // Word boundary match - avoid matching "ETHernet" -> ETH
      const re = new RegExp(`\\b${name}\\b`, 'i');
      if (re.test(lower)) return symbol;
    }
  }

  return null;
}

/**
 * TradingView mini chart widget. We use the basic chart embed because it
 * handles the heavy lifting (chart data, candles, indicators) for free
 * and reliably. Configuration:
 *   - Dark theme to match our app
 *   - Time-series view, no fancy controls (keep it focused)
 *   - Symbol prop drives reload via key prop on the iframe
 *
 * Performance gate: in dev mode the external script is heavy (~600KB) and
 * triggers re-fetches on every HMR. We default to a placeholder unless
 * NEXT_PUBLIC_ENABLE_TRADINGVIEW=1 is set, or NODE_ENV is production.
 */
function TradingViewChart({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string>(`tv-${Math.random().toString(36).slice(2, 10)}`);

  /*
   * Whether to actually load the TradingView SDK.
   *   - In production: always on
   *   - In dev: off by default (avoids HMR re-fetches), opt-in via env
   */
  const enabled =
    process.env.NODE_ENV === 'production' ||
    process.env.NEXT_PUBLIC_ENABLE_TRADINGVIEW === '1';

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    // Clear previous widget
    containerRef.current.innerHTML = '';

    const inner = document.createElement('div');
    inner.id = widgetIdRef.current;
    inner.style.height = '100%';
    inner.style.width = '100%';
    containerRef.current.appendChild(inner);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => {
      // The TradingView global is loaded — instantiate widget
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const TV = (window as any).TradingView;
      if (TV && TV.widget) {
        new TV.widget({
          autosize: true,
          symbol,
          interval: '60',
          timezone: 'Etc/UTC',
          theme: 'dark',
          style: '1',
          locale: 'en',
          backgroundColor: 'rgba(13, 13, 16, 0.8)',
          gridColor: 'rgba(255, 255, 255, 0.06)',
          allow_symbol_change: false,
          save_image: false,
          hide_top_toolbar: false,
          hide_legend: false,
          container_id: widgetIdRef.current,
        });
      }
    };
    script.onerror = () => {
      if (containerRef.current) {
        containerRef.current.innerHTML =
          '<div class="text-center text-txt-muted text-xs p-4">Failed to load TradingView. Check your network.</div>';
      }
    };
    containerRef.current.appendChild(script);

    return () => {
      // Cleanup script + widget when symbol changes
      try {
        if (containerRef.current) containerRef.current.innerHTML = '';
      } catch {
        /* no-op */
      }
    };
  }, [symbol, enabled]);

  // Dev-mode placeholder: friendly message + symbol echo, no network.
  if (!enabled) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-500/5 via-transparent to-transparent">
        <div className="text-center px-4">
          <div className="text-4xl mb-3 opacity-60">{'\u{1F4C8}'}</div>
          <p className="text-amber-200/90 text-sm font-medium font-mono">{symbol}</p>
          <p className="text-txt-muted text-[11px] mt-2 leading-relaxed max-w-xs mx-auto">
            Chart widget disabled in dev to keep HMR fast.<br />
            <span className="text-txt-faint">Set <code className="text-amber-300/70">NEXT_PUBLIC_ENABLE_TRADINGVIEW=1</code> to enable, or it will turn on automatically in production.</span>
          </p>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className="w-full h-full" />;
}

/**
 * Position calculator. Pure computation, no network. Computes:
 *   - Risk per unit          = |entry - stopLoss|
 *   - Reward per unit        = |takeProfit - entry|
 *   - Risk:Reward ratio
 *   - % move to SL / TP
 *   - $ P&L at SL / TP given size
 */
function PositionCalculator({ symbol, accentRgb }: { symbol: string; accentRgb: string }) {
  const [entry, setEntry] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [size, setSize] = useState('');

  const result = useMemo(() => {
    const e = parseFloat(entry);
    const sl = parseFloat(stopLoss);
    const tp = parseFloat(takeProfit);
    const sz = parseFloat(size);
    if (!Number.isFinite(e) || e <= 0) return null;

    const slValid = Number.isFinite(sl) && sl > 0;
    const tpValid = Number.isFinite(tp) && tp > 0;
    const szValid = Number.isFinite(sz) && sz > 0;

    const riskPerUnit = slValid ? Math.abs(e - sl) : null;
    const rewardPerUnit = tpValid ? Math.abs(tp - e) : null;
    const rrRatio =
      riskPerUnit !== null && rewardPerUnit !== null && riskPerUnit > 0
        ? rewardPerUnit / riskPerUnit
        : null;
    const pctToSl = slValid ? ((sl - e) / e) * 100 : null;
    const pctToTp = tpValid ? ((tp - e) / e) * 100 : null;
    const dollarLoss = szValid && riskPerUnit !== null ? -riskPerUnit * sz : null;
    const dollarGain = szValid && rewardPerUnit !== null ? rewardPerUnit * sz : null;

    return { rrRatio, pctToSl, pctToTp, dollarLoss, dollarGain };
  }, [entry, stopLoss, takeProfit, size]);

  return (
    <div className="p-3 space-y-2.5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-txt-secondary">
          Position Calculator
        </p>
        <span className="text-[10px] text-txt-faint font-mono">{symbol}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CalcInput label="Entry" value={entry} onChange={setEntry} accentRgb={accentRgb} />
        <CalcInput label="Stop Loss" value={stopLoss} onChange={setStopLoss} accentRgb={accentRgb} />
        <CalcInput label="Take Profit" value={takeProfit} onChange={setTakeProfit} accentRgb={accentRgb} />
        <CalcInput label="Size (units)" value={size} onChange={setSize} accentRgb={accentRgb} />
      </div>

      {result && (
        <div className="grid grid-cols-2 gap-1.5 mt-2 pt-2 border-t border-edge/40">
          <Stat
            label="R:R"
            value={result.rrRatio !== null ? `1 : ${result.rrRatio.toFixed(2)}` : '—'}
            tone={result.rrRatio !== null && result.rrRatio >= 2 ? 'good' : 'neutral'}
          />
          <Stat
            label="% to TP"
            value={result.pctToTp !== null ? `${result.pctToTp >= 0 ? '+' : ''}${result.pctToTp.toFixed(2)}%` : '—'}
            tone="neutral"
          />
          <Stat
            label="$ Profit (TP)"
            value={result.dollarGain !== null ? `+$${result.dollarGain.toFixed(2)}` : '—'}
            tone="good"
          />
          <Stat
            label="$ Loss (SL)"
            value={result.dollarLoss !== null ? `$${result.dollarLoss.toFixed(2)}` : '—'}
            tone="bad"
          />
        </div>
      )}
    </div>
  );
}

function CalcInput({
  label,
  value,
  onChange,
  accentRgb,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  accentRgb: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-txt-muted uppercase tracking-wider">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        className="px-2 py-1 bg-surface-0/60 border border-edge/60 rounded text-xs text-white font-mono focus:outline-none focus:border-edge-hover transition-colors"
        style={{
          // Subtle workspace-tinted focus ring on actual focus
          // (declarative focus styles work better than dynamic refs here)
        }}
        onFocus={(e) => {
          e.target.style.borderColor = `rgba(${accentRgb} / 0.6)`;
        }}
        onBlur={(e) => {
          e.target.style.borderColor = '';
        }}
      />
    </label>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'bad' | 'neutral';
}) {
  const toneClass =
    tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-white';
  return (
    <div className="bg-surface-0/40 rounded px-2 py-1.5 border border-edge/40">
      <p className="text-[9px] uppercase tracking-wider text-txt-muted">{label}</p>
      <p className={`text-xs font-semibold tabular-nums font-mono ${toneClass}`}>{value}</p>
    </div>
  );
}

export function TradingPanel({ messages }: Props) {
  const detectedSymbol = useMemo(() => detectTickerFromMessages(messages), [messages]);
  const [symbol, setSymbol] = useState('BTCUSD');
  const [symbolInput, setSymbolInput] = useState('BTCUSD');

  // When a new ticker is detected, sync the chart automatically
  useEffect(() => {
    if (detectedSymbol && detectedSymbol !== symbol) {
      setSymbol(detectedSymbol);
      setSymbolInput(detectedSymbol);
    }
  }, [detectedSymbol]);

  // Trading workspace accent color (amber) — used by calculator focus ring
  const ACCENT_RGB = '245 158 11';

  return (
    <div className="flex flex-col h-full bg-surface-1/40 backdrop-blur-xl border-l border-edge/60 min-w-0">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-edge/60 flex items-center gap-2 shrink-0">
        <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13l4-4 4 4 8-8" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 5h5v5" />
        </svg>
        <p className="text-xs font-semibold text-white uppercase tracking-wider">Market View</p>
        <form
          className="ml-auto flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const sym = symbolInput.trim().toUpperCase();
            if (sym) setSymbol(sym);
          }}
        >
          <input
            type="text"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            placeholder="symbol"
            className="text-[11px] font-mono w-20 px-2 py-0.5 bg-surface-0/60 border border-edge/60 rounded focus:outline-none focus:border-amber-500/60 transition-colors uppercase"
          />
          <button
            type="submit"
            className="text-[11px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 btn-squash"
          >
            Load
          </button>
        </form>
      </div>

      {/* Chart - 60% of vertical space */}
      <div className="flex-[3] min-h-0 relative">
        <TradingViewChart symbol={symbol} />
        {detectedSymbol && detectedSymbol === symbol && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[10px] text-amber-200 backdrop-blur-sm">
            {'\u2728'} Auto-detected from chat
          </div>
        )}
      </div>

      {/* Calculator - 40% of vertical space */}
      <div className="flex-[2] min-h-0 border-t border-edge/60 overflow-y-auto">
        <PositionCalculator symbol={symbol} accentRgb={ACCENT_RGB} />
      </div>
    </div>
  );
}
