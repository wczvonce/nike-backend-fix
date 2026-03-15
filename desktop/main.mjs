import { app, BrowserWindow, dialog } from "electron";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const DEFAULT_PORT = Number(process.env.DESKTOP_PORT || 3131);
let backendPort = DEFAULT_PORT;

let backendProcess = null;
let mainWindow = null;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 3;
let isAppQuitting = false;
let backendLogStream = null;

function baseUrl() {
  return `http://127.0.0.1:${backendPort}`;
}

function ensureBackendLogger() {
  if (backendLogStream) return backendLogStream;
  const logPath = path.join(app.getPath("userData"), "backend.log");
  backendLogStream = fs.createWriteStream(logPath, { flags: "a" });
  backendLogStream.write(`\n=== Desktop launch ${new Date().toISOString()} ===\n`);
  return backendLogStream;
}

function logBackendLine(line) {
  const stream = ensureBackendLogger();
  stream.write(`${new Date().toISOString()} ${line}\n`);
}

function resolveRuntimeRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return projectRoot;
}

function resolveServerPath() {
  const root = resolveRuntimeRoot();
  return app.isPackaged
    ? path.join(root, "app.asar", "src", "server.js")
    : path.join(root, "src", "server.js");
}

function resolveIconPath() {
  const root = resolveRuntimeRoot();
  const iconRel = path.join("desktop", "assets", "app-icon.png");
  const packagedIcon = path.join(root, "app.asar", iconRel);
  const unpackedIcon = path.join(root, iconRel);
  return app.isPackaged ? packagedIcon : unpackedIcon;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function chooseBackendPort() {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = DEFAULT_PORT + i;
    const free = await isPortFree(candidate);
    if (free) return candidate;
  }
  throw new Error("No free local port available for desktop backend.");
}

async function waitForBackend(timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl()}/health`, { method: "GET" });
      if (res.ok) return true;
    } catch {
      // Backend still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return false;
}

async function startBackend() {
  if (backendProcess && !backendProcess.killed) return;
  backendPort = await chooseBackendPort();
  const nodeExe = process.execPath;
  const serverPath = resolveServerPath();

  backendProcess = spawn(nodeExe, [serverPath], {
    cwd: resolveRuntimeRoot(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(backendPort),
      HEADLESS: process.env.HEADLESS || "true"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  backendProcess.stdout?.on("data", (chunk) => {
    const text = String(chunk || "").trim();
    if (!text) return;
    logBackendLine(`[stdout] ${text}`);
  });
  backendProcess.stderr?.on("data", (chunk) => {
    const text = String(chunk || "").trim();
    if (!text) return;
    logBackendLine(`[stderr] ${text}`);
  });

  backendProcess.on("exit", (code) => {
    backendProcess = null;
    logBackendLine(`[exit] code=${code ?? "unknown"} restartAttempts=${restartAttempts}`);
    if (isAppQuitting || !app.isReady()) return;
    if (code === 0) return;

    if (restartAttempts < MAX_RESTART_ATTEMPTS) {
      restartAttempts += 1;
      void (async () => {
        try {
          await startBackend();
          const ok = await waitForBackend(30000);
          if (ok && mainWindow && !mainWindow.isDestroyed()) {
            await mainWindow.loadURL(baseUrl());
          }
        } catch (err) {
          logBackendLine(`[restart-error] ${err?.message || err}`);
        }
      })();
      return;
    }

    dialog.showErrorBox(
      "Backend stopped",
      `Backend process exited unexpectedly (code ${code ?? "unknown"}).\n\nLog: ${path.join(app.getPath("userData"), "backend.log")}`
    );
    app.quit();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    title: "Nike vs Tipsport Comparator",
    icon: resolveIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const isReady = await waitForBackend();
  if (!isReady) {
    dialog.showErrorBox(
      "Startup timeout",
      "Backend did not start in time. Please check terminal logs."
    );
    app.quit();
    return;
  }

  await mainWindow.loadURL(baseUrl());
  restartAttempts = 0;
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) return;
  backendProcess.kill("SIGTERM");
  backendProcess = null;
}

app.on("before-quit", () => {
  isAppQuitting = true;
  app.isQuitting = true;
  stopBackend();
  if (backendLogStream) {
    backendLogStream.end();
    backendLogStream = null;
  }
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    await startBackend();
    await createWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});
