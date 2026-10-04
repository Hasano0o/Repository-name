// Bandly للويندوز — يلف نسخة الويب من التطبيق (web/ = ناتج expo export) داخل نافذة.
// طلبات الشبكة تمر من هنا (Node) بدل المتصفح: عشان صفحة الراوتر ما تنحجب بـ CORS،
// والكوكيز وهيدر Referer تشتغل مثل الجوال.
'use strict';
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, safeStorage, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const WEB_DIR = path.join(__dirname, 'web');
const ORIGIN = 'app://bandly';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

// ───────── ملفات الواجهة ─────────
function serveApp() {
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    let file = path.normalize(path.join(WEB_DIR, rel));
    if (!file.startsWith(WEB_DIR)) return new Response('forbidden', { status: 403 });
    let ok = false;
    try { ok = rel !== '' && fs.statSync(file).isFile(); } catch {}
    if (!ok) file = path.join(WEB_DIR, 'index.html'); // صفحة واحدة — كل المسارات ترجع للتطبيق
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ───────── الشبكة ─────────
const jar = new Map(); // host → Map(name → value)
const inflight = new Map(); // id → AbortController

function storeCookies(host, setCookies) {
  if (!setCookies || !setCookies.length) return;
  let m = jar.get(host);
  if (!m) jar.set(host, (m = new Map()));
  for (const sc of setCookies) {
    const first = sc.split(';')[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    const expired = /max-age=0\b/i.test(sc) || /expires=thu, 01 jan 1970/i.test(sc);
    if (expired || value === '') m.delete(name); else m.set(name, value);
  }
}
function cookieHeader(host) {
  const m = jar.get(host);
  if (!m || !m.size) return null;
  return [...m].map(([k, v]) => `${k}=${v}`).join('; ');
}

ipcMain.handle('net:fetch', async (_e, id, req) => {
  const ctrl = new AbortController();
  inflight.set(id, ctrl);
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    let url = new URL(req.url);
    let method = req.method || 'GET';
    let body = req.body;
    for (let hop = 0; hop < 6; hop++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
      const headers = new Headers();
      for (const [k, v] of req.headers || []) {
        const lk = k.toLowerCase();
        if (lk === 'host' || lk === 'content-length' || lk === 'connection') continue;
        headers.set(k, v);
      }
      if (!headers.has('cookie')) {
        const c = cookieHeader(url.host);
        if (c) headers.set('cookie', c);
      }
      if (!headers.has('user-agent')) headers.set('user-agent', `Bandly-Desktop/${app.getVersion()}`);
      const res = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        redirect: 'manual',
        signal: ctrl.signal,
      });
      storeCookies(url.host, res.headers.getSetCookie ? res.headers.getSetCookie() : []);
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url);
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
          method = 'GET';
          body = undefined;
        }
        continue;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const out = [];
      res.headers.forEach((v, k) => { if (k !== 'set-cookie') out.push([k, v]); });
      return { status: res.status, statusText: res.statusText, headers: out, body: buf, url: url.toString() };
    }
    throw new Error('too many redirects');
  } finally {
    clearTimeout(timer);
    inflight.delete(id);
  }
});
ipcMain.on('net:abort', (_e, id) => inflight.get(id)?.abort());

// ───────── كلمات المرور (مشفّرة بتشفير الويندوز) ─────────
const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json');
function readSecrets() {
  try { return JSON.parse(fs.readFileSync(secretsFile(), 'utf8')); } catch { return {}; }
}
function writeSecrets(obj) {
  fs.mkdirSync(path.dirname(secretsFile()), { recursive: true });
  fs.writeFileSync(secretsFile(), JSON.stringify(obj));
}
const canEncrypt = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
ipcMain.handle('secret:get', (_e, key) => {
  const v = readSecrets()[key];
  if (v == null) return null;
  if (v.startsWith('enc:')) {
    try { return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')); } catch { return null; }
  }
  return Buffer.from(v.slice(4), 'base64').toString('utf8'); // raw:
});
ipcMain.handle('secret:set', (_e, key, value) => {
  const all = readSecrets();
  all[key] = canEncrypt()
    ? 'enc:' + safeStorage.encryptString(String(value)).toString('base64')
    : 'raw:' + Buffer.from(String(value), 'utf8').toString('base64');
  writeSecrets(all);
});
ipcMain.handle('secret:del', (_e, key) => {
  const all = readSecrets();
  delete all[key];
  writeSecrets(all);
});

// ───────── فحص الشبكة وإصلاحها (ويندوز) ─────────
const { execFile } = require('node:child_process');
const IS_WIN = process.platform === 'win32';

function run(file, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err && !stdout ? '' : String(stdout || ''));
    });
  });
}
function ps(script, timeout) {
  const wrapped = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ErrorActionPreference="SilentlyContinue";' + script;
  const enc = Buffer.from(wrapped, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], timeout);
}

// عنوان الراوتر وعنوان الجهاز من الويندوز
const DIAG_PS = `
$up = Get-NetIPConfiguration | ? { $_.NetAdapter.Status -eq 'Up' }
$g = $up | ? { $_.IPv4DefaultGateway } | select -First 1
$w = $up | ? { $_.NetAdapter.PhysicalMediaType -match '802\\.11' } | select -First 1
$pick = if ($g) { $g } else { $w }
[pscustomobject]@{
  gateway = if ($g) { [string]($g.IPv4DefaultGateway.NextHop | select -First 1) } else { $null }
  ip = [string](@($pick.IPv4Address.IPAddress) | select -First 1)
  wifiUp = [bool]$w
  wired = [bool]($up | ? { $_.NetAdapter.PhysicalMediaType -match '802\\.3' -and $_.IPv4DefaultGateway })
} | ConvertTo-Json -Compress`;

function parseMac(s) { return (s || '').trim().toLowerCase(); }
// أول 3 بايتات = الشركة المصنعة (نتجاهل بت "العنوان المحلي")
function oui(mac) {
  const p = mac.split(':');
  if (p.length < 3) return mac;
  return [(parseInt(p[0], 16) & 0xfc).toString(16), p[1], p[2]].join(':');
}

async function wifiInfo() {
  const out = await run('netsh', ['wlan', 'show', 'interfaces']);
  let ssid = null, bssid = null;
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s*(SSID|BSSID|AP BSSID)\s*:\s*(.+)$/i);
    if (!m) continue;
    if (/^SSID$/i.test(m[1])) ssid = m[2].trim();
    else bssid = parseMac(m[2]);
  }
  if (!ssid) return { ssid: null, bssid: null, sameName: 0 };
  // كم جهاز مختلف يبث نفس اسم الشبكة؟
  const nets = await run('netsh', ['wlan', 'show', 'networks', 'mode=bssid']);
  let cur = null;
  const macs = [];
  for (const line of nets.split(/\r?\n/)) {
    const s = line.match(/^SSID\s+\d+\s*:\s*(.*)$/i);
    if (s) { cur = s[1].trim(); continue; }
    const b = line.match(/^\s*BSSID\s+\d+\s*:\s*(.+)$/i);
    if (b && cur === ssid) macs.push(parseMac(b[1]));
  }
  const vendors = new Set(macs.map(oui));
  return { ssid, bssid, sameName: vendors.size };
}

ipcMain.handle('net:diag', async () => {
  // للاختبار فقط: BANDLY_FAKE_NET='{"gateway":...}' يحاكي حالة شبكة
  if (process.env.BANDLY_FAKE_NET) { try { return JSON.parse(process.env.BANDLY_FAKE_NET); } catch { return null; } }
  if (!IS_WIN) return null;
  let base = {};
  try { base = JSON.parse((await ps(DIAG_PS)).replace(/^\uFEFF/, '').trim() || '{}'); } catch {}
  const wifi = base.wifiUp ? await wifiInfo() : { ssid: null, bssid: null, sameName: 0 };
  const ip = base.ip || null;
  return {
    gateway: base.gateway || null,
    ip,
    noAddress: !base.gateway || !ip || ip.startsWith('169.254.'),
    wired: !!base.wired,
    ssid: wifi.ssid,
    duplicateSsid: wifi.sameName > 1,
  };
});

// إصلاح: يشغّل خدمات الشبكة ويطلب عنوان جديد — بصلاحية المسؤول (الويندوز يسأل المستخدم)
const REPAIR_PS = `
foreach($s in 'Dhcp','NlaSvc','netprofm','WlanSvc','Dnscache'){ Set-Service $s -StartupType Automatic; Start-Service $s }
Get-NetAdapter | ? { $_.Status -eq 'Up' } | % { Set-NetIPInterface -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -Dhcp Enabled }
ipconfig /release | Out-Null
ipconfig /flushdns | Out-Null
ipconfig /renew | Out-Null`;

ipcMain.handle('net:repair', async () => {
  if (process.env.BANDLY_FAKE_NET) return true;
  if (!IS_WIN) return false;
  const inner = Buffer.from('$ErrorActionPreference="SilentlyContinue";' + REPAIR_PS, 'utf16le').toString('base64');
  const outer = `try { Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${inner}' -ErrorAction Stop; 'ok' } catch { 'denied' }`;
  const r = (await ps(outer, 120000)).trim();
  if (r !== 'ok') return false;
  await new Promise((res) => setTimeout(res, 4000)); // نعطي الراوتر وقت يوزع العنوان
  return true;
});

ipcMain.on('net:wifiSettings', () => { if (IS_WIN) shell.openExternal('ms-settings:network-wifi'); });

// ───────── رسائل وروابط ─────────
ipcMain.handle('ui:dialog', async (e, title, message, buttons, cancelId) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const opts = {
    type: 'none',
    title: title || 'Bandly',
    message: title || message || '',
    detail: title ? message || '' : '',
    buttons: buttons && buttons.length ? buttons : ['حسناً'],
    cancelId: typeof cancelId === 'number' ? cancelId : 0,
    defaultId: 0,
    noLink: true,
  };
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return r.response;
});
const SAFE_EXTERNAL = /^(https?|mailto|tel|tg|whatsapp):/i;
ipcMain.on('ui:open', (_e, url) => {
  if (typeof url === 'string' && SAFE_EXTERNAL.test(url)) shell.openExternal(url);
});


// ───────── وضع الفني (نافذة صفحة الفني من السيرفر) ─────────
// صفحة الفني على السيرفر فيها كل شي (مكالمة، رسائل صوتية، كاميرا العميل، السجل، التقييم)
// وتشتغل في متصفح البرنامج كما هي — فنفتحها في نافذة Bandly مستقلة.
const LIVE_ORIGIN = 'https://has-host.com';
const LIVE_PATH = /^\/live(\/|$)/;
let techWin = null;
function isLiveUrl(u) {
  try { const x = new URL(u); return x.origin === LIVE_ORIGIN && LIVE_PATH.test(x.pathname); } catch { return false; }
}
function openTech(code) {
  const c = /^\d{6}$/.test(String(code || '')) ? String(code) : '';
  const url = `${LIVE_ORIGIN}/live/${c}`;
  if (techWin && !techWin.isDestroyed()) {
    if (c) techWin.loadURL(url);
    if (techWin.isMinimized()) techWin.restore();
    techWin.focus();
    return;
  }
  techWin = new BrowserWindow({
    width: 1280, height: 860, minWidth: 400, minHeight: 560,
    title: 'Bandly — وضع الفني',
    backgroundColor: '#eceff4',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  techWin.setMenuBarVisibility(false);
  techWin.webContents.setWindowOpenHandler(({ url }) => {
    if (SAFE_EXTERNAL.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  techWin.webContents.on('will-navigate', (ev, url) => {
    if (!isLiveUrl(url)) { ev.preventDefault(); if (SAFE_EXTERNAL.test(url)) shell.openExternal(url); }
  });
  techWin.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F5') techWin.webContents.reload();
  });
  techWin.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMain) => {
    if (!isMain || code === -3) return; // -3 = انلغى (تنقّل عادي)
    techWin.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<html dir="rtl"><body style="font-family:Segoe UI,Tahoma;background:#eceff4;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
      '<div style="text-align:center;color:#1d2433"><h2>ما قدرنا نفتح صفحة الفني</h2><p style="color:#5b6478">تأكد إن اللابتوب متصل بالإنترنت، وبعدها اضغط F5</p></div></body></html>'));
  });
  techWin.on('closed', () => { techWin = null; });
  techWin.loadURL(url);
}
ipcMain.on('tech:open', (_e, code) => openTech(code));

// ───────── التحديث التلقائي ─────────
// السيرفر ينشر dl/bandly-desktop.json مع كل بناء (desktop/build-windows.sh)
const UPDATE_URL = 'https://has-host.com/dl/bandly-desktop.json';
const crypto = require('node:crypto');
const os = require('node:os');

function newer(a, b) { // هل a أحدث من b؟
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

let updateBusy = false;
async function checkForUpdate(manual = false) {
  if (updateBusy) return;
  if (!app.isPackaged || process.platform !== 'win32') {
    if (manual && win) dialog.showMessageBox(win, { type: 'none', title: 'Bandly', message: 'التحديث يشتغل في النسخة المثبتة على الويندوز فقط', buttons: ['حسناً'] });
    return;
  }
  updateBusy = true;
  try {
    const r = await fetch(UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    const info = await r.json();
    const url = new URL(info.url);
    if (url.origin !== 'https://has-host.com') throw new Error('bad url');
    if (!newer(info.version, app.getVersion())) {
      if (manual && win) await dialog.showMessageBox(win, { type: 'none', title: 'Bandly', message: 'عندك آخر نسخة ✓', detail: `النسخة ${app.getVersion()}`, buttons: ['حسناً'] });
      return;
    }
    if (!win) return;
    const sizeMb = info.size ? ` (${Math.round(info.size / 1048576)} ميقا)` : '';
    const ask = await dialog.showMessageBox(win, {
      type: 'none', title: 'تحديث جديد',
      message: 'فيه نسخة جديدة من Bandly',
      detail: (info.notes ? info.notes + '\n\n' : '') + `التحميل${sizeMb} — بعدها البرنامج يتحدث ويفتح من جديد.`,
      buttons: ['حدّث الحين', 'لاحقاً'], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (ask.response !== 0) return;

    // التحميل مع شريط تقدم على أيقونة البرنامج
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error('download ' + res.status);
    const total = Number(res.headers.get('content-length')) || info.size || 0;
    const file = path.join(os.tmpdir(), `Bandly-Setup-${String(info.version).replace(/[^\d.]/g, '')}.exe`);
    const out = fs.createWriteStream(file);
    const hash = crypto.createHash('sha256');
    let got = 0;
    for await (const chunk of res.body) {
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await new Promise(r2 => out.once('drain', r2));
      if (total && win) win.setProgressBar(Math.min(got / total, 1));
    }
    await new Promise((r2, j) => out.end(err => (err ? j(err) : r2())));
    if (win) win.setProgressBar(-1);
    if (info.sha256 && hash.digest('hex') !== String(info.sha256).toLowerCase()) {
      try { fs.unlinkSync(file); } catch {}
      throw new Error('الملف وصل ناقص أو تالف');
    }
    const { spawn } = require('node:child_process');
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    flush();
    setTimeout(() => app.quit(), 500);
  } catch (e) {
    if (win) win.setProgressBar(-1);
    if (manual && win) dialog.showMessageBox(win, { type: 'none', title: 'Bandly', message: 'ما قدرنا نتحقق من التحديث', detail: 'تأكد من الإنترنت وجرّب بعدين.\n' + (e && e.message ? e.message : ''), buttons: ['حسناً'] });
  } finally {
    updateBusy = false;
  }
}
ipcMain.on('update:check', () => checkForUpdate(true));
ipcMain.on('app:version', (e) => { e.returnValue = app.getVersion(); });

// ───────── النافذة ─────────
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 400,
    minHeight: 560,
    title: 'Bandly',
    backgroundColor: '#eceff4',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());

  // أي رابط خارجي ينفتح في المتصفح، والنافذة ما تطلع من التطبيق
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (SAFE_EXTERNAL.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (ev, url) => {
    if (!url.startsWith(ORIGIN)) {
      ev.preventDefault();
      if (SAFE_EXTERNAL.test(url)) shell.openExternal(url);
    }
  });
  // F5 = تحديث، F12 = أدوات المطور (للدعم الفني)
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') win.webContents.reload();
    if (input.key === 'F12') win.webContents.toggleDevTools();
  });

  win.loadURL(ORIGIN + '/');
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  serveApp();
  // الميكروفون والكاميرا لصفحة الفني ولواجهة التطبيق فقط
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    const u = String(details?.requestingUrl || wc.getURL() || '');
    const trusted = u.startsWith(ORIGIN + '/') || u.startsWith(LIVE_ORIGIN + '/');
    cb(trusted && ['media', 'notifications', 'clipboard-sanitized-write'].includes(perm));
  });
  createWindow();
  // يشيك على التحديثات بعد ما يفتح، وكل 6 ساعات
  setTimeout(() => checkForUpdate(false), 8000);
  setInterval(() => checkForUpdate(false), 6 * 3600 * 1000);
  // الراوترات والإعدادات محفوظة في تخزين المتصفح، وكرومium يأجّل كتابتها للقرص —
  // نكتبها كل كم ثانية وعند الإغلاق عشان ما تضيع لو انطفى الجهاز أو انقفل البرنامج غصب
  setInterval(() => { try { session.defaultSession.flushStorageData(); } catch {} }, 3000);
});

const flush = () => { try { session.defaultSession.flushStorageData(); } catch {} };
app.on('before-quit', flush);
app.on('session-end', flush); // إيقاف تشغيل الويندوز / تسجيل الخروج
process.on('SIGTERM', () => { flush(); app.quit(); });

app.on('window-all-closed', () => app.quit());
