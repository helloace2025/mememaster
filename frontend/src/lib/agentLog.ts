/**
 * Global agent activity log — terminal-style task stream for the shell.
 * Pages push events while agents fetch tokens / tweets / sites / LLM.
 */

export type AgentLogLevel = "info" | "run" | "ok" | "warn" | "err";

export type AgentLogEntry = {
  id: string;
  ts: number;
  level: AgentLogLevel;
  agent: string;
  message: string;
};

export type AgentSession = {
  id: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "done" | "error";
};

type Listener = () => void;

const MAX_LOGS = 200;

export type AgentProgress = {
  /** task in flight */
  active: boolean;
  /** completed steps */
  done: number;
  /** total steps (0 = indeterminate) */
  total: number;
  /** short label for UI */
  label: string;
  /** flash green complete state before hide */
  finishing: boolean;
};

const EMPTY_PROGRESS: AgentProgress = {
  active: false,
  done: 0,
  total: 0,
  label: "",
  finishing: false,
};

let logs: AgentLogEntry[] = [];
let sessions: AgentSession[] = [];
let open = false;
let progress: AgentProgress = { ...EMPTY_PROGRESS };
let finishTimer: ReturnType<typeof setTimeout> | null = null;
let listeners = new Set<Listener>();

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribeAgentLog(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getAgentLogs() {
  return logs;
}

export function getAgentSessions() {
  return sessions;
}

export function isAgentTerminalOpen() {
  return open;
}

export function setAgentTerminalOpen(v: boolean) {
  open = v;
  emit();
}

export function toggleAgentTerminal() {
  open = !open;
  emit();
}

export function agentLog(
  agent: string,
  message: string,
  level: AgentLogLevel = "info"
) {
  const entry: AgentLogEntry = {
    id: uid(),
    ts: Date.now(),
    level,
    agent,
    message,
  };
  logs = [...logs.slice(-(MAX_LOGS - 1)), entry];
  // 仅后台记日志；终端展开只由用户点击顶栏手动控制
  emit();
  return entry.id;
}

export function getAgentProgress(): AgentProgress {
  return progress;
}

/** Start a determinate progress track (does not open the terminal drawer). */
export function beginAgentProgress(total: number, label: string) {
  if (finishTimer) {
    clearTimeout(finishTimer);
    finishTimer = null;
  }
  progress = {
    active: true,
    done: 0,
    total: Math.max(0, total),
    label,
    finishing: false,
  };
  emit();
}

/** Advance one step; optional label update for the chip. */
export function tickAgentProgress(label?: string) {
  if (!progress.active && !progress.finishing) return;
  const total = progress.total || 1;
  const done = Math.min(total, progress.done + 1);
  progress = {
    ...progress,
    active: true,
    done,
    label: label ?? progress.label,
    finishing: false,
  };
  emit();
}

/** Mark complete → brief 100% flash → hide bar. */
export function finishAgentProgress(label?: string) {
  if (finishTimer) {
    clearTimeout(finishTimer);
    finishTimer = null;
  }
  const total = progress.total > 0 ? progress.total : Math.max(1, progress.done);
  progress = {
    active: false,
    done: total,
    total,
    label: label ?? progress.label,
    finishing: true,
  };
  emit();
  finishTimer = setTimeout(() => {
    progress = { ...EMPTY_PROGRESS };
    finishTimer = null;
    emit();
  }, 480);
}

export function startAgentSession(title: string, steps?: number): string {
  const id = uid();
  const session: AgentSession = {
    id,
    title,
    startedAt: Date.now(),
    status: "running",
  };
  sessions = [...sessions.filter((s) => s.status !== "running"), session].slice(
    -12
  );
  agentLog("system", title, "run");
  if (steps != null && steps > 0) {
    beginAgentProgress(steps, title);
  } else if (steps === 0) {
    // indeterminate-style: total 0, still show bar
    beginAgentProgress(0, title);
  }
  return id;
}

export function endAgentSession(
  id: string,
  status: "done" | "error" = "done",
  message?: string
) {
  sessions = sessions.map((s) =>
    s.id === id
      ? { ...s, status, endedAt: Date.now() }
      : s
  );
  if (message) {
    agentLog("system", message, status === "done" ? "ok" : "err");
  } else {
    agentLog(
      "system",
      status === "done" ? "任务完成" : "任务失败",
      status === "done" ? "ok" : "err"
    );
  }
  if (progress.active || progress.finishing) {
    finishAgentProgress(message);
  }
}

/** Convenience: wrap an async agent step with run/ok/err logs */
export async function withAgentStep<T>(
  agent: string,
  startMsg: string,
  fn: () => Promise<T>,
  okMsg?: (result: T) => string
): Promise<T> {
  agentLog(agent, startMsg, "run");
  try {
    const result = await fn();
    agentLog(
      agent,
      okMsg ? okMsg(result) : `${startMsg.replace(/…+$/, "")} · 完成`,
      "ok"
    );
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    agentLog(agent, `${startMsg.replace(/…+$/, "")} 失败: ${msg}`, "err");
    throw e;
  }
}

export function clearAgentLogs() {
  logs = [];
  emit();
}

export function currentRunningSession(): AgentSession | null {
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].status === "running") return sessions[i];
  }
  return null;
}

export function latestLogLine(): AgentLogEntry | null {
  return logs.length ? logs[logs.length - 1] : null;
}
