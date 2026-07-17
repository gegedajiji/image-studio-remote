import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 45_000;
const testRunId = randomUUID().replace(/-/g, '').slice(0, 12);
const args = new Map();

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const [key, inlineValue] = arg.slice(2).split('=');
  const value = inlineValue ?? process.argv[index + 1];
  if (inlineValue === undefined) index += 1;
  args.set(key, value);
}

const sourceRoot = path.resolve(args.get('source') || process.cwd());
const keepTemp = args.has('keep-temp');
const adminAccount = String(args.get('admin-account') || 'admin');
const adminPassword = String(args.get('admin-password') || '12345678');
const checks = [];
const cleanupTasks = [];
let tempRoot = '';

function record(name, ok, detail = {}) {
  const item = { ...detail, name, ok: Boolean(ok) };
  checks.push(item);
  if (!item.ok) process.exitCode = 1;
  return item.ok;
}

function assertCheck(name, condition, detail = {}) {
  if (!record(name, condition, detail)) {
    throw new Error(`${name} failed${detail.error ? `: ${detail.error}` : ''}`);
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function listen(server, host = '127.0.0.1') {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to allocate a local port');
  return `http://${host}:${address.port}`;
}

async function copyProjectToTemp() {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'youyu-ui-routes-'));
  const excludedNames = new Set(['.git', '.playwright-cli', 'data', 'node_modules', 'output']);
  await fs.cp(sourceRoot, tempRoot, {
    recursive: true,
    filter: (entry) => {
      const relative = path.relative(sourceRoot, entry);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      if (parts.some((part) => excludedNames.has(part))) return false;
      const base = path.basename(entry);
      if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return false;
      if (base.startsWith('._')) return false;
      if (base.endsWith('.tgz') || base.endsWith('.tar.gz')) return false;
      return true;
    }
  });

  try {
    await fs.symlink(path.join(sourceRoot, 'node_modules'), path.join(tempRoot, 'node_modules'), 'dir');
  } catch {
    // The app startup log will make a missing dependency failure explicit.
  }

  cleanupTasks.push(async () => {
    if (!keepTemp && tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  });
  return tempRoot;
}

function spawnApp({ appRoot, appBaseUrl }) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: appRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: new URL(appBaseUrl).port,
      PUBLIC_BASE_URL: appBaseUrl,
      APP_SECRET: `ui-smoke-secret-${testRunId}`,
      ADMIN_USERNAME: adminAccount,
      ADMIN_PASSWORD: adminPassword,
      IMAGE_UPSTREAM_BASE_URL: 'http://127.0.0.1:9',
      IMAGE_UPSTREAM_API_KEY: 'ui-smoke-fake-key',
      IMAGE_MODEL: 'ui-smoke-image-model',
      TEXT_MODEL: 'ui-smoke-text-model',
      IMAGE_WORKER_DISABLED: '1',
      STORE_PERSIST_COALESCE_MS: '0',
      LOG_LEVEL: 'warn'
    }
  });

  const logs = [];
  const collect = (streamName) => (chunk) => {
    const text = chunk.toString();
    logs.push(`[${streamName}] ${text}`);
    if (logs.length > 100) logs.shift();
  };
  child.stdout.on('data', collect('stdout'));
  child.stderr.on('data', collect('stderr'));

  cleanupTasks.push(() => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 2500);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  }));

  return { child, logs };
}

async function runNodeSnippet(appRoot, code, label) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: appRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      APP_SECRET: `ui-smoke-seed-secret-${testRunId}`,
      ADMIN_USERNAME: adminAccount,
      ADMIN_PASSWORD: adminPassword,
      IMAGE_UPSTREAM_BASE_URL: 'http://127.0.0.1:9',
      IMAGE_UPSTREAM_API_KEY: 'ui-smoke-fake-key',
      IMAGE_MODEL: 'ui-smoke-image-model',
      TEXT_MODEL: 'ui-smoke-text-model',
      STORE_PERSIST_COALESCE_MS: '0',
      LOG_LEVEL: 'warn'
    }
  });
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk.toString()));
  child.stderr.on('data', (chunk) => chunks.push(chunk.toString()));
  const exitCode = await new Promise((resolve) => child.once('exit', resolve));
  const output = chunks.join('');
  if (exitCode !== 0) throw new Error(`${label} failed with code ${exitCode}\n${output}`);
  return output;
}

async function seedPendingGeneration(appRoot) {
  const code = `
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import { addBalance, createChargedGeneration, initStore, snapshot } from './src/store.js';

    await initStore({ recoverPending: false });
    const admin = snapshot().users.find((user) => user.role === 'admin');
    if (!admin) throw new Error('admin user not found');
    await addBalance({
      userId: admin.id,
      amountCents: 500,
      reason: 'UI smoke pending generation seed',
      operatorId: admin.id
    });
    const charged = await createChargedGeneration({
      userId: admin.id,
      amountCents: 100,
      reason: 'UI smoke pending generation seed',
      generation: {
        source: 'web',
        mode: 'generate',
        prompt: 'UI smoke pending auto resume',
        quality: '2k',
        size: '1024x1024',
        outputFormat: 'jpeg',
        count: 1,
        layout: 'single',
        priceCents: 100,
        images: [],
        sourceImages: [],
        metadata: { uiSmokePendingAutoResume: true }
      }
    });
    const generation = charged.generation;
    const job = {
      version: 1,
      savedAt: Date.now(),
      generationId: generation.id,
      user: {
        id: admin.id,
        account: admin.account || '',
        username: admin.username || '',
        role: admin.role || 'admin',
        status: admin.status || 'active'
      },
      source: 'web',
      prompt: generation.prompt,
      mode: generation.mode,
      quality: generation.quality,
      size: generation.size,
      outputFormat: generation.outputFormat,
      count: generation.count,
      layout: generation.layout,
      storyboardPrompts: [],
      priceCents: generation.priceCents,
      finalImageDataUrls: [],
      finalMaskDataUrl: ''
    };
    const jobDir = path.resolve('data/jobs');
    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(path.join(jobDir, generation.id + '.json'), JSON.stringify(job, null, 2));
    console.log(JSON.stringify({ generationId: generation.id }));
  `;
  const output = await runNodeSnippet(appRoot, code, 'seed pending generation');
  const line = output.trim().split(/\r?\n/).filter(Boolean).pop() || '{}';
  return JSON.parse(line);
}

async function requestOk(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  if (!response.ok) throw new Error(`${pathName} returned ${response.status}`);
  return response.json();
}

async function waitForApp(baseUrl, appProcess, logs) {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) {
      throw new Error(`app exited early with code ${appProcess.exitCode}\n${logs.join('')}`);
    }
    try {
      const body = await requestOk(baseUrl, '/api/health');
      if (body?.success) return body;
    } catch (error) {
      lastError = error;
    }
    await sleep(350);
  }
  throw new Error(`app did not become healthy: ${lastError?.message || 'timeout'}\n${logs.join('')}`);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.GOOGLE_CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium'
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return '';
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    socket.addEventListener('message', (event) => this.handleMessage(event.data));
  }

  handleMessage(raw) {
    const text = typeof raw === 'string' ? raw : raw?.toString?.() || '';
    if (!text) return;
    const message = JSON.parse(text);
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result || {});
      return;
    }
    if (message.method) this.events.push(message);
  }

  send(method, params = {}, sessionId = '') {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  close() {
    this.socket.close();
  }
}

async function connectWebSocket(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return new CdpClient(socket);
}

async function launchChrome(chromePath) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'youyu-ui-chrome-'));
  cleanupTasks.push(async () => {
    if (!keepTemp) await fs.rm(userDataDir, { recursive: true, force: true });
  });
  const child = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const logs = [];
  const collect = (chunk) => {
    logs.push(chunk.toString());
    if (logs.length > 100) logs.shift();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  cleanupTasks.push(() => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 2500);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  }));

  const activePortFile = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Chrome exited early with code ${child.exitCode}\n${logs.join('')}`);
    }
    try {
      const [port, browserPath] = (await fs.readFile(activePortFile, 'utf8')).trim().split(/\r?\n/);
      if (port && browserPath) {
        return {
          child,
          client: await connectWebSocket(`ws://127.0.0.1:${port}${browserPath}`)
        };
      }
    } catch {
      // Wait for Chrome to write DevToolsActivePort.
    }
    await sleep(150);
  }
  throw new Error(`Chrome did not expose DevTools in time\n${logs.join('')}`);
}

async function createPage(client) {
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  await client.send('Page.enable', {}, sessionId);
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Log.enable', {}, sessionId);
  return sessionId;
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result?.value;
}

async function waitFor(client, sessionId, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    lastValue = await evaluate(client, sessionId, expression).catch((error) => ({ error: error.message }));
    if (lastValue === true || lastValue?.ok) return lastValue;
    await sleep(120);
  }
  throw new Error(`${label} timed out; last=${JSON.stringify(lastValue)}`);
}

async function setViewport(client, sessionId, width, height) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 760
  }, sessionId);
  await client.send('Emulation.setVisibleSize', { width, height }, sessionId).catch(() => {});
}

async function navigate(client, sessionId, url, waitExpression = 'document.readyState === "complete"') {
  await client.send('Page.navigate', { url }, sessionId);
  await waitFor(client, sessionId, waitExpression, `navigate ${url}`);
}

function uiProbeExpression() {
  return `(() => {
    const visible = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const colorValueMetric = (value = '') => {
      const match = value.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/);
      if (!match) return { value, luminance: null, alpha: null };
      const channels = match.slice(1, 4).map((channel) => Number(channel) / 255).map((channel) => (
        channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      ));
      return {
        value,
        luminance: (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]),
        alpha: match[4] === undefined ? 1 : Number(match[4])
      };
    };
    const colorMetric = (selector, property = 'backgroundColor') => {
      const el = selector === 'body' ? document.body : document.querySelector(selector);
      if (!el) return null;
      return colorValueMetric(getComputedStyle(el)[property] || '');
    };
    const opaqueLightSurface = (el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width * r.height < 1000 || style.display === 'none' || style.visibility === 'hidden') return false;
      const solid = colorValueMetric(style.backgroundColor);
      const image = style.backgroundImage || '';
      const brightImage = image.includes('rgb(255, 255, 255)')
        || ['0.7', '0.8', '0.9'].some((alpha) => image.includes('rgba(255, 255, 255, ' + alpha));
      return Boolean((solid.alpha >= 0.7 && solid.luminance >= 0.65) || brightImage);
    };
    const railRect = document.querySelector('.studio-rail')?.getBoundingClientRect();
    const composerRect = document.querySelector('.composer-card:not([hidden])')?.getBoundingClientRect();
    const visibleComposerControls = Array.from(document.querySelectorAll('.composer-card:not([hidden]) .composer-toolbar .select-pill')).filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    });
    const visibleRailActions = Array.from(document.querySelectorAll('.rail-nav .rail-action')).filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    });
    const centerHit = (el) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(innerWidth - 1, Math.max(0, r.left + (r.width / 2)));
      const y = Math.min(innerHeight - 1, Math.max(0, r.top + (r.height / 2)));
      return document.elementFromPoint(x, y);
    };
    const isHittable = (el) => {
      const hit = centerHit(el);
      return Boolean(hit && (hit === el || el.contains(hit)));
    };
    const adminNav = document.querySelector('#adminNavBtn:not([hidden])');
    const adminNavHit = adminNav ? centerHit(adminNav) : null;
    return {
      path: location.pathname,
      panel: document.body.dataset.panel,
      classes: document.body.className,
      width: innerWidth,
      height: innerHeight,
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
      visible: {
        rail: visible('.studio-rail'),
        generate: visible('#generateBtn'),
        authModal: visible('#authModal.open .login-campaign-dialog'),
        accountModal: visible('#accountModal.open .account-dialog'),
        accountButton: visible('#headerAccountBtn'),
        historyPanel: visible('#historySection'),
        historyBackdrop: visible('#historyBackdrop'),
        featurePanel: visible('.feature-panel:not([hidden])'),
        featureEmpty: visible('.feature-empty'),
        communityIntro: visible('#promptLibraryPanel .feature-head p'),
        communityExplainer: visible('#promptLibraryPanel .community-explainer'),
        communityCard: visible('.community-card'),
        adminConsole: visible('#adminConsolePanel'),
        adminAuthModal: visible('#authModal.open'),
        infiniteCanvas: visible('#infiniteCanvasPanel:not([hidden])')
      },
      counts: {
        railActions: visibleRailActions.length,
        railActionsHittable: visibleRailActions.every(isHittable),
        railLabelsFit: visibleRailActions.every((el) => {
          const label = el.querySelector('.rail-copy strong');
          return !label || label.scrollWidth <= label.clientWidth + 1;
        }),
        adminNavHittable: adminNav ? isHittable(adminNav) : null,
        adminNavHit: adminNavHit ? {
          tag: adminNavHit.tagName,
          id: adminNavHit.id || '',
          className: String(adminNavHit.className || ''),
          closestRailActionId: adminNavHit.closest?.('.rail-action')?.id || ''
        } : null,
        railActionsInside: Boolean(railRect) && visibleRailActions.every((el) => {
          const r = el.getBoundingClientRect();
          return r.left >= railRect.left - 2
            && r.right <= railRect.right + 2
            && r.top >= railRect.top - 2
            && r.bottom <= railRect.bottom + 2;
        }),
        visibleBackdropFilters: Array.from(document.querySelectorAll('body *')).filter((el) => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return r.width > 0 && r.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && style.backdropFilter !== 'none';
        }).length,
        opaqueLightSurfaces: Array.from(document.querySelectorAll('body *')).filter(opaqueLightSurface).length,
        composerControlsInside: !composerRect || visibleComposerControls.every((el) => {
          const r = el.getBoundingClientRect();
          return r.left >= composerRect.left - 2
            && r.right <= composerRect.right + 2
            && r.top >= composerRect.top - 2
            && r.bottom <= composerRect.bottom + 2;
        })
      },
      rects: {
        rail: rect('.studio-rail'),
        railNav: rect('.rail-nav'),
        railBottom: rect('.rail-bottom'),
        adminNav: rect('#adminNavBtn:not([hidden])'),
        loginBtn: rect('#loginBtn'),
        registerBtn: rect('#registerBtn'),
        accountDialog: rect('#accountModal.open .account-dialog'),
        accountLogoutBtn: rect('#accountLogoutBtn'),
        historyPanel: rect('#historySection'),
        historyBackdrop: rect('#historyBackdrop'),
        workspace: rect('.workspace'),
        workspaceContent: rect('.workspace-content'),
        featurePanel: rect('.feature-panel:not([hidden])'),
        composer: rect('.composer-card:not([hidden])'),
        resultThread: rect('.result-thread:not([hidden])'),
        infiniteCanvas: rect('#infiniteCanvasPanel:not([hidden])'),
        generate: rect('#generateBtn'),
        templateCards: Array.from(document.querySelectorAll('#studioTemplateGrid .prompt-card')).map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
        }),
        communitySortButtons: Array.from(document.querySelectorAll('#promptLibraryTags .community-sort-row button')).filter((el) => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }).map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
        })
      },
      styles: {
        scifiLoaded: Array.from(document.styleSheets).some((sheet) => String(sheet.href || '').includes('/scifi-theme.css')),
        bodyBackground: colorMetric('body'),
        railBackground: colorMetric('.studio-rail'),
        workspaceBackground: colorMetric('.workspace'),
        composerBackground: colorMetric('.composer-card'),
        canvasBackground: colorMetric('#infiniteCanvasPanel'),
        headerText: colorMetric('.workspace-title h1', 'color'),
        railPosition: document.querySelector('.studio-rail') ? getComputedStyle(document.querySelector('.studio-rail')).position : null
      },
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      viewportWidthDelta: innerWidth - document.documentElement.clientWidth
    };
  })()`;
}

async function assertNoBrowserErrors(client) {
  const errors = client.events
    .filter((event) => {
      if (event.method === 'Runtime.exceptionThrown') return true;
      if (event.method === 'Runtime.consoleAPICalled') return event.params?.type === 'error';
      if (event.method === 'Log.entryAdded') return event.params?.entry?.level === 'error';
      return false;
    })
    .map((event) => event.params?.entry?.text || event.params?.exceptionDetails?.text || event.params?.args?.map((arg) => arg.value || arg.description).join(' ') || event.method)
    .filter((text) => !String(text || '').includes('favicon'));
  assertCheck('ui:no-console-errors', errors.length === 0, { errors });
}

async function runUiChecks(client, sessionId, appBaseUrl, seeded = {}) {
  await setViewport(client, sessionId, 1440, 950);
  await navigate(client, sessionId, `${appBaseUrl}/image/workspace`, "document.readyState === 'complete' && !!document.querySelector('#generateBtn')");
  const workspace = await evaluate(client, sessionId, uiProbeExpression());
  assertCheck('ui:workspace-desktop-ready', workspace.panel === 'studio'
    && workspace.visible.generate
    && workspace.visible.accountButton
    && !workspace.classes.includes('history-opened')
    && workspace.overflowX <= 2, workspace);

  const templateTops = workspace.rects.templateCards.map((card) => Math.round(card.y));
  assertCheck('ui:scifi-theme-desktop-surface', workspace.styles.scifiLoaded
    && workspace.styles.bodyBackground?.luminance < 0.02
    && workspace.styles.railBackground?.luminance < 0.03
    && workspace.styles.workspaceBackground?.luminance < 0.03
    && workspace.styles.composerBackground?.luminance < 0.04
    && workspace.styles.headerText?.luminance > 0.7
    && workspace.counts.visibleBackdropFilters <= 2
    && workspace.counts.opaqueLightSurfaces === 0
    && workspace.counts.composerControlsInside
    && workspace.rects.templateCards.length === 4
    && new Set(templateTops).size === 1
    && workspace.rects.composer?.right <= (workspace.rects.resultThread?.x || 0) + 2, workspace);

  await evaluate(client, sessionId, "document.querySelector('.size-select .select-pill-trigger')?.click(); true");
  const floatingMenu = await waitFor(client, sessionId, `(() => {
    const menu = document.querySelector('#floatingMenuPortal .floating-pill-menu');
    if (!menu) return null;
    const rect = menu.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + (rect.width / 2), rect.top + Math.min(24, rect.height / 2));
    return {
      ok: rect.width >= 196 && rect.height > 0
        && rect.left >= 10 && rect.right <= innerWidth - 10
        && rect.top >= 10 && rect.bottom <= innerHeight - 10
        && !!hit?.closest('#floatingMenuPortal .floating-pill-menu'),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
      hit: hit?.tagName || null
    };
  })()`, 'floating size menu');
  assertCheck('ui:scifi-floating-menu-top-layer', floatingMenu?.ok === true, floatingMenu || {});
  await evaluate(client, sessionId, "document.querySelector('#floatingMenuPortal [data-size=\"1536x1024\"]')?.click(); true");
  const selectedSize = await waitFor(client, sessionId, "document.querySelector('#sizeLabel strong')?.textContent?.includes('1536x1024')", 'floating size selection');
  assertCheck('ui:floating-menu-selection-updates-label', selectedSize === true, { selectedSize });

  await evaluate(client, sessionId, `(async () => {
    const { renderGeneratedImages } = await import('/modules/preview-controller.js');
    renderGeneratedImages({
      id: 'ui-smoke-multi-result',
      status: 'completed',
      prompt: 'UI smoke multi image result',
      size: '1024x1024',
      quality: '2k',
      count: 4,
      outputFormat: 'jpeg',
      images: [
        { imageUrl: '/assets/templates/guofeng-campaign.jpg', outputFormat: 'jpeg' },
        { imageUrl: '/assets/templates/porcelain-museum.jpg', outputFormat: 'jpeg' },
        { imageUrl: '/assets/templates/poster-character.jpg', outputFormat: 'jpeg' },
        { imageUrl: '/assets/templates/game-scene.jpg', outputFormat: 'jpeg' }
      ]
    });
    return true;
  })()`);
  await waitFor(client, sessionId, "document.querySelectorAll('.result-image-frame.is-loaded').length === 4", 'desktop multi result images');
  const desktopResult = await evaluate(client, sessionId, `(() => {
    const grid = document.querySelector('.multi-result');
    const cards = Array.from(document.querySelectorAll('.multi-result .result-card'));
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).filter(Boolean) : [];
    return {
      ok: cards.length === 4
        && columns.length === 2
        && cards.every((card) => card.querySelectorAll('.result-actions > a, .result-actions > button, .result-actions > details').length === 4)
        && cards.every((card) => card.querySelector('.result-image-frame.is-loaded img[data-result-image]')),
      cards: cards.length,
      columns,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  })()`);
  const desktopResultSurface = await evaluate(client, sessionId, uiProbeExpression());
  assertCheck('ui:desktop-multi-result-grid-and-actions', desktopResult?.ok === true
    && desktopResult.overflowX <= 2
    && desktopResultSurface.counts.opaqueLightSurfaces === 0, {
    ...desktopResult,
    opaqueLightSurfaces: desktopResultSurface.counts.opaqueLightSurfaces
  });

  await evaluate(client, sessionId, "document.querySelector('#openCanvasBtn')?.click(); true");
  await waitFor(client, sessionId, "document.body.classList.contains('infinite-canvas-open') && !document.querySelector('#infiniteCanvasPanel')?.hidden", 'infinite canvas open', 10_000);
  const canvas = await evaluate(client, sessionId, uiProbeExpression());
  assertCheck('ui:scifi-infinite-canvas-surface', canvas.visible.infiniteCanvas
    && canvas.styles.canvasBackground?.luminance < 0.04
    && canvas.counts.opaqueLightSurfaces === 0
    && canvas.rects.infiniteCanvas?.x >= (canvas.rects.workspace?.x || 0)
    && canvas.rects.infiniteCanvas?.right <= (canvas.rects.workspace?.right || canvas.width) + 2
    && canvas.overflowX <= 2, canvas);
  await evaluate(client, sessionId, "document.querySelector('#canvasCloseBtn')?.click(); true");
  await waitFor(client, sessionId, "!document.body.classList.contains('infinite-canvas-open') && !!document.querySelector('#generateBtn:not([hidden])')", 'infinite canvas close');

  await evaluate(client, sessionId, "document.querySelector('#headerAccountBtn')?.click(); true");
  await waitFor(client, sessionId, "!!document.querySelector('#authModal.open .login-campaign-dialog')", 'auth modal open');
  let auth = await evaluate(client, sessionId, uiProbeExpression());
  assertCheck('ui:auth-login-dialog-layout', auth.visible.authModal
    && auth.rects.loginBtn
    && auth.rects.registerBtn
    && Math.abs(auth.rects.loginBtn.y - auth.rects.registerBtn.y) <= 3
    && auth.rects.loginBtn.width > auth.rects.registerBtn.width
    && auth.counts.opaqueLightSurfaces === 0, auth);

  await evaluate(client, sessionId, "document.querySelector('#registerBtn')?.click(); true");
  await waitFor(client, sessionId, "document.querySelector('#authModal')?.classList.contains('is-registering')", 'register mode');
  auth = await evaluate(client, sessionId, uiProbeExpression());
  assertCheck('ui:auth-register-stable-actions', auth.visible.authModal
    && auth.rects.loginBtn
    && auth.rects.registerBtn
    && Math.abs(auth.rects.loginBtn.y - auth.rects.registerBtn.y) <= 3
    && auth.rects.registerBtn.x > auth.rects.loginBtn.x, auth);

  for (const width of [1181, 1439, 1440]) {
    await setViewport(client, sessionId, width, 950);
    await navigate(client, sessionId, `${appBaseUrl}/image/history`, "document.readyState === 'complete' && !!document.querySelector('#historySection')");
    const history = await evaluate(client, sessionId, uiProbeExpression());
    assertCheck(`ui:history-column-at-${width}`, history.panel === 'studio'
      && history.classes.includes('history-opened')
      && history.visible.historyPanel
      && !history.visible.historyBackdrop
      && history.rects.historyPanel?.width >= 250
      && history.rects.historyPanel?.right <= (history.rects.workspace?.x || 0) + 2
      && history.counts.composerControlsInside
      && history.counts.opaqueLightSurfaces === 0
      && history.overflowX <= 2, history);
  }

  await setViewport(client, sessionId, 390, 844);
  await navigate(client, sessionId, `${appBaseUrl}/image/workspace`, "document.readyState === 'complete' && !!document.querySelector('#generateBtn')");
  const mobile = await evaluate(client, sessionId, uiProbeExpression());
  assertCheck('ui:mobile-primary-nav-visible', mobile.counts.railActions >= 6
    && mobile.visible.generate
    && mobile.visible.accountButton
    && mobile.counts.railActionsInside
    && mobile.counts.railActionsHittable
    && mobile.counts.railLabelsFit
    && mobile.rects.railNav?.height >= 50
    && mobile.rects.railNav?.height <= 72
    && mobile.viewportWidthDelta <= 1
    && mobile.overflowX <= 2, mobile);

  await evaluate(client, sessionId, `(async () => {
    const { renderGeneratedImages } = await import('/modules/preview-controller.js');
    renderGeneratedImages({
      id: 'ui-smoke-mobile-result-menu',
      status: 'completed',
      prompt: 'UI smoke mobile result menu',
      size: '1024x1024',
      quality: '2k',
      count: 1,
      outputFormat: 'jpeg',
      images: [{ imageUrl: '/assets/templates/guofeng-campaign.jpg', outputFormat: 'jpeg' }]
    });
    document.querySelector('.result-thread')?.scrollIntoView({ block: 'start' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.querySelector('.result-more-menu > summary')?.click();
    return true;
  })()`);
  const mobileResultMenu = await waitFor(client, sessionId, `(() => {
    const details = document.querySelector('.result-more-menu[open]');
    const menu = details?.querySelector('.result-more-popover');
    if (!menu) return null;
    const rect = menu.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + (rect.width / 2), rect.top + 12);
    return {
      ok: rect.left >= 8
        && rect.top >= 8
        && rect.right <= innerWidth - 8
        && rect.bottom <= innerHeight - 68
        && !!hit?.closest('.result-more-popover'),
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      hit: hit?.tagName || null,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  })()`, 'mobile result more menu');
  assertCheck('ui:mobile-result-more-menu-in-viewport', mobileResultMenu?.ok === true
    && mobileResultMenu.overflowX <= 2, mobileResultMenu || {});

  await navigate(client, sessionId, `${appBaseUrl}/image/history`, "document.readyState === 'complete' && !!document.querySelector('#historySection')");
  const mobileHistory = await evaluate(client, sessionId, uiProbeExpression());
  assertCheck('ui:mobile-history-route-opens-drawer', mobileHistory.panel === 'studio'
    && mobileHistory.classes.includes('history-mobile-open')
    && mobileHistory.visible.historyPanel
    && mobileHistory.rects.railNav?.height >= 50
    && mobileHistory.rects.railNav?.height <= 72
    && mobileHistory.viewportWidthDelta <= 1
    && mobileHistory.overflowX <= 2, mobileHistory);

  await setViewport(client, sessionId, 1440, 950);
  await navigate(client, sessionId, `${appBaseUrl}/prompts`, "document.readyState === 'complete' && !!document.querySelector('.feature-empty, .community-card')");
  const prompts = await evaluate(client, sessionId, uiProbeExpression());
  assertCheck('ui:community-empty-or-cards-visible', prompts.panel === 'prompts'
    && (prompts.visible.featureEmpty || prompts.visible.communityCard)
    && prompts.visible.featurePanel
    && !prompts.visible.historyBackdrop
    && prompts.rects.workspace?.width >= prompts.width * 0.6
    && prompts.rects.featurePanel?.x >= (prompts.rects.workspace?.x || 0)
    && prompts.rects.featurePanel?.width >= (prompts.rects.workspace?.width || 0) * 0.8
    && prompts.overflowX <= 2, prompts);

  const loginResult = await evaluate(client, sessionId, `fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ account: ${JSON.stringify(adminAccount)}, password: ${JSON.stringify(adminPassword)} })
  }).then((res) => res.json()).then((body) => ({ success: body.success, role: body.user?.role || null }))`);
  assertCheck('ui:admin-login-via-browser', loginResult?.success === true && loginResult?.role === 'admin', loginResult || {});

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 932 }
  ]) {
    await setViewport(client, sessionId, viewport.width, viewport.height);
    await navigate(client, sessionId, `${appBaseUrl}/image/workspace`, "document.readyState === 'complete' && !!document.querySelector('#adminNavBtn:not([hidden])')");
    const mobileAdmin = await evaluate(client, sessionId, uiProbeExpression());
    assertCheck(`ui:mobile-admin-nav-${viewport.width}`, mobileAdmin.panel === 'studio'
      && mobileAdmin.counts.railActions >= 7
      && mobileAdmin.counts.railActionsInside
      && mobileAdmin.counts.railActionsHittable
      && mobileAdmin.counts.railLabelsFit
      && mobileAdmin.counts.adminNavHittable
      && mobileAdmin.rects.railNav?.height >= 50
      && mobileAdmin.rects.railNav?.height <= 72
      && mobileAdmin.viewportWidthDelta <= 1
      && mobileAdmin.overflowX <= 2, mobileAdmin);
  }

  await setViewport(client, sessionId, 390, 844);
  await navigate(client, sessionId, `${appBaseUrl}/image/workspace`, "document.readyState === 'complete' && !!document.querySelector('#headerAccountBtn')");
  await evaluate(client, sessionId, "document.querySelector('#headerAccountBtn')?.click(); true");
  await waitFor(client, sessionId, "!!document.querySelector('#accountModal.open .account-dialog')", 'account modal open');
  const accountModal = await evaluate(client, sessionId, uiProbeExpression());
  assertCheck('ui:account-dialog-mobile-scifi-surface', accountModal.visible.accountModal
    && accountModal.rects.accountDialog?.x >= 8
    && accountModal.rects.accountDialog?.right <= accountModal.width - 8
    && accountModal.rects.accountLogoutBtn?.width > 0
    && accountModal.counts.opaqueLightSurfaces === 0
    && accountModal.overflowX <= 2, accountModal);
  await evaluate(client, sessionId, "document.querySelector('#accountCloseBtn')?.click(); true");

  await setViewport(client, sessionId, 390, 844);
  for (const route of [
    { path: '/prompts', panel: 'prompts' },
    { path: '/agent', panel: 'agent' },
    { path: '/api-docs', panel: 'developers' },
    { path: '/settings', panel: 'settings' },
    { path: '/admin/users', panel: 'admin' }
  ]) {
    await navigate(client, sessionId, `${appBaseUrl}${route.path}`, `document.body.dataset.panel === '${route.panel}' && !!document.querySelector('.feature-panel:not([hidden])')`);
    const mobileRoute = await evaluate(client, sessionId, uiProbeExpression());
    assertCheck(`ui:${route.panel}-mobile-scifi-bottom-nav`, mobileRoute.panel === route.panel
      && mobileRoute.styles.scifiLoaded
      && mobileRoute.styles.bodyBackground?.luminance < 0.02
      && mobileRoute.styles.railPosition === 'fixed'
      && mobileRoute.rects.rail?.height >= 60
      && mobileRoute.rects.rail?.bottom <= mobileRoute.height
      && mobileRoute.counts.railActionsInside
      && mobileRoute.counts.railActionsHittable
      && mobileRoute.counts.railLabelsFit
      && mobileRoute.counts.opaqueLightSurfaces === 0
      && (route.panel !== 'prompts' || (
        !mobileRoute.visible.communityIntro
        && !mobileRoute.visible.communityExplainer
        && mobileRoute.rects.communitySortButtons.length === 4
        && new Set(mobileRoute.rects.communitySortButtons.map((button) => Math.round(button.y))).size === 1
      ))
      && mobileRoute.overflowX <= 2, mobileRoute);
  }

  await setViewport(client, sessionId, 1440, 950);

  for (const route of [
    { path: '/agent', panel: 'agent', selector: '#agentPanel' },
    { path: '/api-docs', panel: 'developers', selector: '#apiDocsPanel' },
    { path: '/settings', panel: 'settings', selector: '#settingsPanel' }
  ]) {
    await navigate(client, sessionId, `${appBaseUrl}${route.path}`, `document.body.dataset.panel === '${route.panel}' && !!document.querySelector('${route.selector}:not([hidden])')`);
    const routeProbe = await evaluate(client, sessionId, uiProbeExpression());
    assertCheck(`ui:${route.panel}-desktop-main-column`, routeProbe.panel === route.panel
      && routeProbe.visible.featurePanel
      && !routeProbe.visible.historyBackdrop
      && routeProbe.rects.workspace?.width >= routeProbe.width * 0.6
      && routeProbe.rects.featurePanel?.x >= (routeProbe.rects.workspace?.x || 0)
      && routeProbe.rects.featurePanel?.width >= (routeProbe.rects.workspace?.width || 0) * 0.8
      && routeProbe.counts.opaqueLightSurfaces === 0
      && routeProbe.overflowX <= 2, routeProbe);
  }

  await navigate(client, sessionId, `${appBaseUrl}/admin/billing`, "document.body.dataset.panel === 'admin' && !!document.querySelector('[data-admin-tab=\"billing\"].active')");
  await evaluate(client, sessionId, "document.querySelector('[data-admin-tab=\"users\"]')?.click(); true");
  await waitFor(client, sessionId, "location.pathname === '/admin/users' && !!document.querySelector('[data-admin-tab=\"users\"].active')", 'admin users tab route');
  await evaluate(client, sessionId, 'history.back(); true');
  const adminBackNavigation = await waitFor(client, sessionId, `(() => ({
    ok: location.pathname === '/admin/billing'
      && document.body.dataset.panel === 'admin'
      && !!document.querySelector('[data-admin-tab="billing"].active')
      && !!document.querySelector('[data-admin-section="billing"].active'),
    path: location.pathname,
    panel: document.body.dataset.panel,
    activeTab: document.querySelector('[data-admin-tab].active')?.dataset.adminTab || '',
    activeSection: document.querySelector('[data-admin-section].active')?.dataset.adminSection || ''
  }))()`, 'admin browser back navigation');
  assertCheck('ui:admin-browser-history-syncs-active-tab', adminBackNavigation?.ok === true, adminBackNavigation || {});

  if (seeded.pendingGenerationId) {
    await setViewport(client, sessionId, 1440, 950);
    await navigate(client, sessionId, `${appBaseUrl}/image/history`, "document.readyState === 'complete' && !!document.querySelector('#historySection')");
    const autoResume = await waitFor(client, sessionId, `(() => {
      const currentCard = document.querySelector('[data-generation-id="${seeded.pendingGenerationId}"]');
      return {
        ok: document.body.classList.contains('generating-active')
          && !!currentCard
          && !!document.querySelector('#preview.loading, .preview-card.loading'),
        classes: document.body.className,
        hasCard: !!currentCard,
        status: document.querySelector('#status')?.textContent || '',
        previewMeta: document.querySelector('#generationBannerMeta')?.textContent || ''
      };
    })()`, 'pending generation auto resume', 8000);
    assertCheck('ui:history-pending-auto-resumes-preview', autoResume?.ok === true, {
      pendingGenerationId: seeded.pendingGenerationId,
      ...autoResume
    });
  }

  await setViewport(client, sessionId, 900, 900);
  await navigate(client, sessionId, `${appBaseUrl}/admin/users`, "document.readyState === 'complete' && (!!document.querySelector('#adminConsolePanel') || !!document.querySelector('#authModal.open'))");
  await waitFor(client, sessionId, "!!document.querySelector('#adminConsolePanel') && !document.querySelector('#authModal.open')", 'admin console visible', 10_000);
  await waitFor(client, sessionId, "!!document.querySelector('#adminUserList td[data-label], #adminUserList .feature-empty')", 'admin user table rendered', 10_000);
  const admin = await evaluate(client, sessionId, `(() => {
    const td = document.querySelector('#adminUserList td[data-label]');
    const before = td ? getComputedStyle(td, '::before').content : '';
    const display = td ? getComputedStyle(td).display : '';
    const hasEmpty = !!document.querySelector('#adminUserList .feature-empty');
    const probe = ${uiProbeExpression()};
    return { ...probe, adminCellBefore: before, adminCellDisplay: display, adminHasEmpty: hasEmpty };
  })()`);
  assertCheck('ui:admin-table-labels-readable-at-900', admin.panel === 'admin'
    && admin.visible.adminConsole
    && admin.counts.railActions >= 7
    && admin.counts.railActionsInside
    && (admin.rects.workspace?.x || 0) - (admin.rects.rail?.right || 0) <= 16
    && (admin.adminHasEmpty || (admin.adminCellBefore && admin.adminCellBefore !== 'none'))
    && admin.overflowX <= 2, admin);

  await setViewport(client, sessionId, 900, 520);
  await navigate(client, sessionId, `${appBaseUrl}/image/workspace`, "document.readyState === 'complete' && !!document.querySelector('#generateBtn')");
  const shortWorkspace = await evaluate(client, sessionId, `(() => {
    const toolbar = document.querySelector('.composer-card:not([hidden]) .composer-toolbar');
    const toolbarRect = toolbar?.getBoundingClientRect();
    const controls = Array.from(toolbar?.querySelectorAll('[data-select]') || []).filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    });
    const templates = Array.from(document.querySelectorAll('#studioTemplateGrid .prompt-card')).filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    });
    const generate = document.querySelector('#generateBtn');
    const generateRect = generate?.getBoundingClientRect();
    const generateHit = generateRect
      ? document.elementFromPoint(generateRect.left + (generateRect.width / 2), generateRect.top + (generateRect.height / 2))
      : null;
    const rect = (el) => {
      const value = el.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom };
    };
    return {
      controls: controls.map((el) => ({
        select: el.dataset.select || '',
        rect: rect(el),
        textFits: Array.from(el.querySelectorAll('.spec-label strong')).every((label) => label.scrollWidth <= label.clientWidth + 1)
      })),
      controlsInsideToolbar: !!toolbarRect && controls.every((el) => {
        const value = el.getBoundingClientRect();
        return value.left >= toolbarRect.left - 2
          && value.right <= toolbarRect.right + 2
          && value.top >= toolbarRect.top - 2
          && value.bottom <= toolbarRect.bottom + 2;
      }),
      generate: generateRect ? rect(generate) : null,
      generateHittable: !!generate && !!generateHit && (generateHit === generate || generate.contains(generateHit)),
      templateTops: templates.map((el) => Math.round(el.getBoundingClientRect().top)),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      viewport: { width: innerWidth, height: innerHeight }
    };
  })()`);
  assertCheck('ui:short-desktop-workspace-first-screen', shortWorkspace.controls.length === 5
    && new Set(shortWorkspace.controls.map((control) => control.select)).size === 5
    && shortWorkspace.controlsInsideToolbar
    && shortWorkspace.controls.find((control) => control.select === 'size')?.textFits
    && shortWorkspace.generate?.x >= 0
    && shortWorkspace.generate?.right <= shortWorkspace.viewport.width
    && shortWorkspace.generate?.y >= 0
    && shortWorkspace.generate?.bottom <= shortWorkspace.viewport.height
    && shortWorkspace.generateHittable
    && shortWorkspace.templateTops.length === 4
    && new Set(shortWorkspace.templateTops).size === 1
    && shortWorkspace.overflowX <= 2, shortWorkspace);

  await setViewport(client, sessionId, 900, 520);
  await navigate(client, sessionId, `${appBaseUrl}/admin/users`, "document.readyState === 'complete' && !!document.querySelector('#adminConsolePanel')");
  await evaluate(client, sessionId, `new Promise((resolve) => {
    document.querySelector('#adminNavBtn:not([hidden])')?.scrollIntoView({ block: 'nearest' });
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
  })`);
  const shortAdmin = await evaluate(client, sessionId, uiProbeExpression());
  assertCheck('ui:short-desktop-admin-nav-reachable', shortAdmin.panel === 'admin'
    && shortAdmin.counts.railActions >= 7
    && shortAdmin.counts.adminNavHittable
    && shortAdmin.rects.adminNav?.y >= (shortAdmin.rects.railNav?.y || 0) - 2
    && shortAdmin.rects.adminNav?.bottom <= (shortAdmin.rects.railNav?.bottom || 0) + 2
    && shortAdmin.overflowX <= 2, shortAdmin);
}

async function cleanup() {
  for (const task of cleanupTasks.reverse()) {
    await Promise.resolve()
      .then(task)
      .catch(() => {});
  }
}

async function main() {
  const chromePath = await findChrome();
  assertCheck('ui:chrome-available', Boolean(chromePath), { chromePath: chromePath || null });
  if (!chromePath) throw new Error('Chrome/Chromium not found; set CHROME_BIN to run UI smoke');

  const appRoot = await copyProjectToTemp();
  const seeded = await seedPendingGeneration(appRoot);
  assertCheck('ui:seed-pending-generation', Boolean(seeded?.generationId), seeded || {});
  const portServer = http.createServer((_req, res) => res.end('reserved'));
  const appBaseUrl = await listen(portServer);
  await new Promise((resolve) => portServer.close(resolve));
  const { child: appProcess, logs } = spawnApp({ appRoot, appBaseUrl });
  const health = await waitForApp(appBaseUrl, appProcess, logs);
  assertCheck('ui:app-healthy', health?.success === true, {
    imageReady: health?.imageReady,
    queue: health?.generationQueue
  });

  const { client } = await launchChrome(chromePath);
  cleanupTasks.push(() => client.close());
  const sessionId = await createPage(client);
  await runUiChecks(client, sessionId, appBaseUrl, { pendingGenerationId: seeded.generationId });
  await assertNoBrowserErrors(client);

  console.log(JSON.stringify({
    ok: checks.every((item) => item.ok),
    sourceRoot,
    tempRoot: keepTemp ? tempRoot : undefined,
    appBaseUrl,
    chromePath,
    checkedAt: new Date().toISOString(),
    checks
  }, null, 2));
}

try {
  await main();
} catch (error) {
  record('smoke:ui-routes', false, {
    error: error.message,
    tempRoot: keepTemp ? tempRoot : undefined
  });
  console.error(JSON.stringify({
    ok: false,
    sourceRoot,
    tempRoot: keepTemp ? tempRoot : undefined,
    checkedAt: new Date().toISOString(),
    checks
  }, null, 2));
  process.exitCode = 1;
} finally {
  await cleanup();
}
