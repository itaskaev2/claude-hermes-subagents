#!/usr/bin/env node
// Minimal zero-dependency MCP stdio server: runs Hermes one-shot queries (locally or over SSH).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const HOST = process.env.HERMES_SSH_HOST || "hermes.home.local";
const BIN = process.env.HERMES_BIN || "~/.local/bin/hermes";
const LOCAL_BIN = process.env.HERMES_LOCAL_BIN || "hermes";
const WSL_DISTRO = process.env.HERMES_WSL_DISTRO || "Ubuntu";
const WSL_BIN = process.env.HERMES_WSL_BIN || "~/.local/bin/hermes";
// Default target: ssh | local | wsl. HERMES_LOCAL=1 is kept as an alias for local.
const DEFAULT_TARGET = process.env.HERMES_DEFAULT_TARGET || (process.env.HERMES_LOCAL === "1" ? "local" : "ssh");
const TARGETS = ["ssh", "local", "wsl"];
const DEFAULT_TIMEOUT = Number(process.env.HERMES_TIMEOUT_SEC || 600);
const MAX_PARALLEL = Number(process.env.HERMES_MAX_PARALLEL || 6);

// Single-quote for POSIX sh.
const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
// Keep a leading ~/ expandable on the remote side.
const shBin = (b) => (b.startsWith("~/") ? '"$HOME"/' + q(b.slice(2)) : q(b));

const runSchema = {
  type: "object",
  properties: {
    target: { type: "string", enum: TARGETS, description: "Where to run Hermes: ssh (remote Hermes host), local (Hermes on this computer), wsl (Hermes inside WSL on this computer). Default: " + DEFAULT_TARGET + ". When resuming, use the same target as the original call." },
    prompt: { type: "string", description: "Self-contained task for the Hermes subagent. It has no access to this conversation." },
    toolsets: { type: "string", description: "Comma-separated Hermes toolsets to enable (optional)." },
    model: { type: "string", description: "Model override, e.g. anthropic/claude-sonnet-4 (optional)." },
    provider: { type: "string", description: "Inference provider override (optional)." },
    reasoning: { type: "string", enum: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] },
    skills: { type: "string", description: "Comma-separated Hermes skills to preload (optional)." },
    workdir: { type: "string", description: "Directory on the target to run in (--in)." },
    resume: { type: "string", description: "Session id from a previous call, to continue that subagent." },
    max_turns: { type: "number", description: "Max agent turns (default: Hermes default)." },
    timeout_sec: { type: "number", description: "Hard timeout in seconds, default " + DEFAULT_TIMEOUT + "." },
    yolo: { type: "boolean", description: "Auto-approve dangerous commands on the Hermes host. Only if the user allowed it." },
  },
  required: ["prompt"],
};

const tools = [
  {
    name: "hermes_run",
    description: "Run one Hermes agent copy as a subagent on the chosen target (ssh host, local, or WSL) and return its final answer plus session_id (pass it as `resume` to continue).",
    inputSchema: runSchema,
  },
  {
    name: "hermes_run_many",
    description: "Run several independent Hermes subagents in parallel (max " + MAX_PARALLEL + " at once) and return all results.",
    inputSchema: {
      type: "object",
      properties: { tasks: { type: "array", minItems: 1, items: runSchema, description: "Independent tasks, one subagent each." } },
      required: ["tasks"],
    },
  },
];

// Returns hermes CLI args (without the binary).
function buildArgs(a) {
  const args = [];
  if (a.yolo) args.push("--yolo");
  args.push("chat", "--query-file", "-", "-Q");
  // Hermes rejects creation overrides on resume: the session keeps its original settings.
  if (a.resume) return args.concat("--resume", String(a.resume));
  const opt = (flag, v) => { if (v !== undefined && v !== "") args.push(flag, String(v)); };
  opt("-t", a.toolsets); opt("-m", a.model); opt("--provider", a.provider);
  opt("--reasoning", a.reasoning); opt("-s", a.skills); opt("--in", a.workdir);
  if (a.max_turns) args.push("--max-turns", String(Math.floor(a.max_turns)));
  return args;
}

function spawnHermes(target, a) {
  const args = buildArgs(a);
  const stdio = ["pipe", "pipe", "pipe"];
  if (target === "local") return spawn(LOCAL_BIN, args, { stdio, windowsHide: true });
  const cmd = (b) => [shBin(b), ...args.map(q)].join(" ");
  if (target === "wsl") return spawn("wsl", ["-d", WSL_DISTRO, "-e", "bash", "-lc", cmd(WSL_BIN)], { stdio, windowsHide: true });
  return spawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", HOST, cmd(BIN)], { stdio });
}

function runOne(a) {
  return new Promise((resolve) => {
    if (!a || typeof a.prompt !== "string" || !a.prompt.trim()) return resolve({ ok: false, text: "prompt is required" });
    const target = a.target || DEFAULT_TARGET;
    if (!TARGETS.includes(target)) return resolve({ ok: false, text: "unknown target " + target });
    const child = spawnHermes(target, a);
    const limit = a.timeout_sec || DEFAULT_TIMEOUT;
    let out = "", err = "", done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => { child.kill(); finish({ ok: false, text: "timeout after " + limit + "s\n" + out }); }, limit * 1000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => finish({ ok: false, text: "spawn failed: " + e.message }));
    child.on("close", (code) => {
      // Hermes prints "session_id: ..." to stderr (older builds: end of stdout).
      const m = out.match(/\n?session_id:\s*(\S+)\s*$/);
      const e = err.match(/session_id:\s*(\S+)/);
      const session = e ? e[1] : m ? m[1] : undefined;
      const answer = (m ? out.slice(0, m.index) : out).trim();
      if (code !== 0) return finish({ ok: false, text: ("exit " + code + "\n" + answer + "\n" + err).trim(), session, target });
      finish({ ok: true, text: answer, session, target });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(a.prompt);
  });
}

const fmt = (r, i) =>
  (i !== undefined ? "## Task " + (i + 1) + "\n" : "") + (r.ok ? "" : "[FAILED] ") + r.text + (r.session ? "\n\nsession_id: " + r.session + " (target: " + r.target + ")" : "");

async function callTool(name, args) {
  if (name === "hermes_run") {
    const r = await runOne(args);
    return { content: [{ type: "text", text: fmt(r) }], isError: !r.ok };
  }
  if (name === "hermes_run_many") {
    const tasks = Array.isArray(args && args.tasks) ? args.tasks : [];
    if (!tasks.length) return { content: [{ type: "text", text: "tasks is required" }], isError: true };
    const results = new Array(tasks.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, tasks.length) }, async () => {
      while (next < tasks.length) { const i = next++; results[i] = await runOne(tasks[i]); }
    }));
    return { content: [{ type: "text", text: results.map(fmt).join("\n\n---\n\n") }], isError: results.every((r) => !r.ok) };
  }
  return { content: [{ type: "text", text: "unknown tool " + name }], isError: true };
}

const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === "initialize") {
    return send({ jsonrpc: "2.0", id, result: { protocolVersion: (params && params.protocolVersion) || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "hermes-subagents", version: "0.1.0" } } });
  }
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools } });
  if (method === "tools/call") {
    try { return send({ jsonrpc: "2.0", id, result: await callTool(params.name, params.arguments) }); }
    catch (e) { return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(e) }], isError: true } }); }
  }
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + method } });
});
// Stay alive until stdin closes and in-flight calls finish.
rl.on("close", () => setTimeout(() => process.exit(0), 100).unref());
