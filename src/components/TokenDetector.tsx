'use client';

import { useState, useRef } from 'react';
import { Button } from './Button';
import { Badge } from './Badge';
import { Alert } from './Alert';

interface DetectedToken {
  source: string;
  type: 'kiro' | 'aws_sso' | 'unknown';
  preview: string;
  expiresAt?: string;
  startUrl?: string;
  region?: string;
}

interface ValidatedToken {
  refreshToken: string;
  type: string;
  source: string;
  expiresAt?: string;
  startUrl?: string;
  validation: {
    valid: boolean;
    endpoint?: string;
    expiresIn?: number;
    error?: string;
  };
}

interface Props {
  onTokenSelected: (token: string, name?: string) => void;
}

export function TokenDetector({ onTokenSelected }: Props) {
  const [scanning, setScanning] = useState(false);
  const [validating, setValidating] = useState(false);
  const [tokens, setTokens] = useState<DetectedToken[]>([]);
  const [selectedToken, setSelectedToken] = useState<ValidatedToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scanServer = async () => {
    setScanning(true);
    setError(null);
    setSelectedToken(null);
    try {
      const res = await fetch('/api/tokens/detect');
      const data = await res.json();
      if (res.ok) {
        setTokens(data.tokens);
        setScanned(true);
      } else {
        setError(data.error || 'Scan failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setScanning(false);
    }
  };

  const selectFromScan = async (token: DetectedToken) => {
    setValidating(true);
    setError(null);
    try {
      const res = await fetch('/api/tokens/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: token.source }),
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedToken({
          ...data.token,
          validation: data.validation,
        });
      } else {
        setError(data.error || 'Failed to load token');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setValidating(false);
    }
  };

  const uploadFile = async (file: File) => {
    setValidating(true);
    setError(null);
    try {
      const text = await file.text();
      const res = await fetch('/api/tokens/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileContent: text }),
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedToken({
          ...data.token,
          validation: data.validation,
        });
      } else {
        setError(data.error || 'Failed to parse file');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read file');
    } finally {
      setValidating(false);
    }
  };

  const useToken = () => {
    if (!selectedToken) return;
    const name = selectedToken.startUrl?.includes('codewhisperer')
      ? 'Kiro (AWS SSO)'
      : selectedToken.startUrl?.includes('kiro')
      ? 'Kiro IDE'
      : selectedToken.type === 'kiro'
      ? 'Kiro'
      : 'Kiro Auto-detected';
    onTokenSelected(selectedToken.refreshToken, name);
  };

  return (
    <div className="bg-surface-1 border border-edge rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-white">Auto-detect Token</h3>
          <p className="text-xs text-txt-muted mt-0.5">
            Cari token Kiro/AWS SSO di server, atau upload file token dari laptop
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Alert type="error">{error}</Alert>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Button onClick={scanServer} loading={scanning} variant="primary" size="sm">
          {scanning ? 'Scanning...' : 'Scan Server Filesystem'}
        </Button>

        <Button
          onClick={() => fileInputRef.current?.click()}
          variant="secondary"
          size="sm"
          disabled={validating}
        >
          Upload Token File
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {/* Help text */}
      <div className="bg-surface-0 border border-edge-subtle rounded-lg p-3 mb-4">
        <p className="text-[11px] text-txt-muted leading-relaxed">
          <span className="text-white font-medium">Cara dapetin token Kiro:</span>
          <br />1. Linux: <code className="font-mono text-txt-secondary">~/.aws/sso/cache/*.json</code>
          <br />2. Windows: <code className="font-mono text-txt-secondary">%USERPROFILE%\.aws\sso\cache\*.json</code>
          <br />3. Kiro IDE config folder (varies by OS)
          <br />Pilih file <code className="font-mono text-txt-secondary">.json</code> yang punya field <code className="font-mono text-txt-secondary">refreshToken</code>
        </p>
      </div>

      {/* Scan results */}
      {scanned && tokens.length === 0 && !selectedToken && (
        <Alert type="warning">
          Ga nemu token di server. Coba upload file manual dari laptop, atau install Kiro IDE/AWS SSO di server dulu.
        </Alert>
      )}

      {tokens.length > 0 && !selectedToken && (
        <div className="space-y-2 mb-4">
          <p className="text-[11px] font-semibold text-txt-muted uppercase tracking-wider">
            Found {tokens.length} token{tokens.length > 1 ? 's' : ''}
          </p>
          {tokens.map((t, i) => (
            <button
              key={i}
              onClick={() => selectFromScan(t)}
              disabled={validating}
              className="w-full text-left bg-surface-0 border border-edge rounded-lg p-3 hover:border-edge-hover hover:bg-surface-2 transition-all disabled:opacity-50"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={t.type === 'kiro' ? 'success' : t.type === 'aws_sso' ? 'info' : 'default'}>
                      {t.type === 'aws_sso' ? 'AWS SSO' : t.type === 'kiro' ? 'KIRO' : 'JSON'}
                    </Badge>
                    <code className="text-xs text-white font-mono">{t.preview}</code>
                  </div>
                  <p className="text-[10px] text-txt-muted font-mono truncate">{t.source}</p>
                  {t.startUrl && <p className="text-[10px] text-txt-faint truncate">URL: {t.startUrl}</p>}
                  {t.expiresAt && (
                    <p className="text-[10px] text-txt-faint">
                      Expires: {new Date(t.expiresAt).toLocaleString()}
                      {new Date(t.expiresAt).getTime() < Date.now() && (
                        <span className="text-red-400 ml-1">(expired)</span>
                      )}
                    </p>
                  )}
                </div>
                <svg className="w-4 h-4 text-txt-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}

      {validating && (
        <div className="text-center py-4">
          <p className="text-sm text-txt-muted">Validating token...</p>
        </div>
      )}

      {/* Selected token preview */}
      {selectedToken && (
        <div className="bg-surface-0 border border-edge rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white">Token Preview</h4>
            <button
              onClick={() => setSelectedToken(null)}
              className="text-xs text-txt-muted hover:text-white transition-colors"
            >
              ← Change
            </button>
          </div>

          <div className="space-y-2 text-xs">
            <Row label="Source" value={selectedToken.source} mono />
            <Row label="Type" value={selectedToken.type} />
            {selectedToken.startUrl && <Row label="Start URL" value={selectedToken.startUrl} mono />}
            {selectedToken.expiresAt && (
              <Row label="Expires At" value={new Date(selectedToken.expiresAt).toLocaleString()} />
            )}
            <Row
              label="Refresh Token"
              value={`${selectedToken.refreshToken.slice(0, 20)}...${selectedToken.refreshToken.slice(-8)} (${selectedToken.refreshToken.length} chars)`}
              mono
            />
          </div>

          <div className="border-t border-edge pt-3">
            <p className="text-[11px] font-semibold text-txt-muted uppercase tracking-wider mb-2">Validation</p>
            {selectedToken.validation.valid ? (
              <Alert type="success">
                <div>
                  <strong>Token valid!</strong>
                  <br />
                  Endpoint: <code className="font-mono">{selectedToken.validation.endpoint}</code>
                  {selectedToken.validation.expiresIn && (
                    <>
                      <br />
                      Access token expires in: {selectedToken.validation.expiresIn}s
                    </>
                  )}
                </div>
              </Alert>
            ) : (
              <Alert type="error">
                <div>
                  <strong>Token tidak bisa di-refresh.</strong>
                  <br />
                  <span className="text-[10px] font-mono break-all">{selectedToken.validation.error}</span>
                  <br /><br />
                  Token mungkin udah expired, atau endpoint Kiro berubah. Lu bisa tetep simpan tokennya, tapi chat ga akan jalan sampai validation sukses.
                </div>
              </Alert>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={useToken} variant="primary" size="sm">
              {selectedToken.validation.valid ? 'Use This Token' : 'Save Anyway'}
            </Button>
            <Button onClick={() => setSelectedToken(null)} variant="secondary" size="sm">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-txt-muted shrink-0 w-24">{label}</span>
      <span className={`text-white break-all ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</span>
    </div>
  );
}
