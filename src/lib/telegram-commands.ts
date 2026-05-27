/**
 * Telegram bot slash commands.
 *
 * The webhook handler tries this dispatcher BEFORE going to the AI
 * model. If a command matches, we reply with the command output.
 * Otherwise, fall through to the normal Kiro chat flow.
 *
 * Commands implemented:
 *   /help          List available commands
 *   /status        Server uptime, memory, container counts
 *   /ps            List running containers (name, state, ports)
 *   /logs [name]   Last 30 log lines from container (default: prometheus)
 *   /health        /api/health output
 *
 * All commands are read-only — the Docker socket is mounted ro:.
 *
 * Output is plain text (not Markdown). Telegram's MarkdownV2 has too
 * many escape gotchas with container names, log content, and error
 * messages; plain text is more reliable.
 */

import {
  listContainers,
  getDockerInfo,
  getContainerLogs,
  getLocalHealth,
  formatBytes,
  formatUptime,
  getHostName,
  getProcessUptime,
} from './server-status';

export interface CommandResult {
  /** True when this input was handled (don't fall through to AI) */
  handled: boolean;
  /** Reply text — empty when handled=false */
  text: string;
}

const COMMAND_LIST = [
  { cmd: '/help', desc: 'Liat semua command yang tersedia' },
  { cmd: '/status', desc: 'Status server (uptime, RAM, container count)' },
  { cmd: '/ps', desc: 'List container Docker yang lagi jalan' },
  { cmd: '/logs', desc: 'Logs container terakhir (default: prometheus)' },
  { cmd: '/health', desc: 'Health check Prometheus app' },
];

function helpText(): string {
  const cmds = COMMAND_LIST.map((c) => `${c.cmd}\n  ${c.desc}`).join('\n\n');
  return [
    'Commands tersedia:',
    '',
    cmds,
    '',
    'Selain command, kirim pesan biasa buat chat AI.',
  ].join('\n');
}

async function statusText(): Promise<string> {
  const lines: string[] = ['Server status:', ''];

  // Local app health (always works)
  const health = await getLocalHealth();
  if ('error' in health) {
    lines.push(`App: error (${health.error})`);
  } else {
    lines.push(`App: ${health.status} (uptime ${formatUptime(health.uptimeSeconds)})`);
    if (health.db) {
      lines.push(`DB:  ${health.db.ok ? 'ok' : 'error'} (${health.db.latencyMs}ms)`);
    }
    if (health.version && health.version !== 'dev') {
      lines.push(`Version: ${health.version}`);
    }
  }

  // Docker host (may fail if socket unreachable)
  try {
    const info = await getDockerInfo();
    lines.push('');
    lines.push(`Host: ${info.Name}`);
    lines.push(`OS:   ${info.OperatingSystem}`);
    lines.push(`CPU:  ${info.NCPU} core`);
    lines.push(`RAM:  ${formatBytes(info.MemTotal)} total`);
    lines.push('');
    lines.push(`Containers: ${info.ContainersRunning} running, ${info.ContainersStopped} stopped`);
    lines.push(`Images:     ${info.Images}`);
    lines.push(`Docker:     v${info.ServerVersion}`);
  } catch (err) {
    lines.push('');
    lines.push(`Docker: unreachable (${(err as Error).message})`);
    lines.push(`Process uptime: ${formatUptime(getProcessUptime())} on ${getHostName()}`);
  }

  return lines.join('\n');
}

async function psText(): Promise<string> {
  try {
    const containers = await listContainers();
    if (containers.length === 0) {
      return 'No containers running.';
    }
    const lines: string[] = [`Containers (${containers.length}):`, ''];
    for (const c of containers) {
      const name = c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12);
      const ports = (c.Ports ?? [])
        .filter((p) => p.PublicPort !== undefined)
        .map((p) => `${p.PublicPort}->${p.PrivatePort}`)
        .join(', ');
      const stateIcon = c.State === 'running' ? '✓' : c.State === 'exited' ? '✗' : '?';
      lines.push(`${stateIcon} ${name}`);
      lines.push(`   image: ${c.Image}`);
      lines.push(`   state: ${c.State} — ${c.Status}`);
      if (ports) lines.push(`   ports: ${ports}`);
      lines.push('');
    }
    return lines.join('\n').trimEnd();
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

async function logsText(name: string): Promise<string> {
  try {
    const logs = await getContainerLogs(name, 30);
    if (!logs.trim()) {
      return `No recent logs from ${name}.`;
    }
    // Telegram limit is 4000 chars per chunk; keep latest tail visible.
    const trimmed = logs.length > 3500 ? `…${logs.slice(-3500)}` : logs;
    return `Last 30 lines from ${name}:\n\n${trimmed}`;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('404')) {
      return `Container "${name}" not found. Try /ps to see available names.`;
    }
    return `Error: ${msg}`;
  }
}

async function healthText(): Promise<string> {
  const h = await getLocalHealth();
  if ('error' in h) {
    return `Health check failed: ${h.error}`;
  }
  const lines = [
    `Status: ${h.status}`,
    `Uptime: ${formatUptime(h.uptimeSeconds)}`,
  ];
  if (h.db) lines.push(`DB:     ${h.db.ok ? 'ok' : 'down'} (${h.db.latencyMs}ms)`);
  if (h.version) lines.push(`Version: ${h.version}`);
  return lines.join('\n');
}

/**
 * Try to handle a Telegram message text as a command. Returns
 * { handled: false } when the text isn't a command — caller should
 * proceed with normal AI dispatch.
 *
 * Slash command parsing handles Telegram's mention suffix:
 *   "/status@nusantaraAI_bot" -> "/status"
 * which Telegram appends in group chats.
 */
export async function handleCommand(text: string): Promise<CommandResult> {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    return { handled: false, text: '' };
  }
  // Split on first whitespace: ['/cmd@bot', 'arg1 arg2 ...']
  const [head, ...rest] = trimmed.split(/\s+/);
  const cmd = head.split('@')[0].toLowerCase();
  const args = rest;

  switch (cmd) {
    case '/help':
    case '/start':
      // /start is handled separately upstream (welcome message), but
      // also accept it here as an alias for /help in case the upstream
      // path changes.
      return { handled: true, text: helpText() };
    case '/status':
      return { handled: true, text: await statusText() };
    case '/ps':
      return { handled: true, text: await psText() };
    case '/logs': {
      const name = (args[0] ?? 'prometheus').replace(/[^a-zA-Z0-9_.-]/g, '');
      if (!name) {
        return { handled: true, text: 'Usage: /logs <container_name>' };
      }
      return { handled: true, text: await logsText(name) };
    }
    case '/health':
      return { handled: true, text: await healthText() };
    default:
      // Unknown slash command — let it fall through so the AI can
      // either explain or treat it as text.
      return { handled: false, text: '' };
  }
}
