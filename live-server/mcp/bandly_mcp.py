#!/usr/bin/env python3
"""
موصّل Claude للرسيفر (MCP — Streamable HTTP، بدون مكتبات) — قراءة بس لملفات Bandly.

ليش: جلسة Claude محجوب عنها has-host.com و SSH، بس طلبات «الموصّلات» تطلع من سيرفرات claude.ai نفسها.
حسن يضيف الرابط في claude.ai ← الإعدادات ← Connectors ← موصّل مخصص:
    https://has-host.com/claude-mcp/<الرمز>
الرمز (token) في /root/bandly-mcp/token — هو القفل. تغييره: bash install.sh --rotate

الأمان:
  • قراءة بس: ما فيه تنفيذ أوامر ولا كتابة ولا حذف ولا إعادة تشغيل.
  • المسارات محصورة في مجلدات Bandly (ROOTS) — أي مسار برا ← مرفوض (realpath).
  • كل نص يطلع يمر على scrub(): IMEI/ICCID/IMSI/السيريال/MAC/الكلمات/المفاتيح/الجلسات/الأرقام الطويلة ← مخفية.
  • systemd: ProtectHome=read-only + ProtectSystem=strict (حتى لو فيه خطأ، ما يقدر يكتب).
"""
import json
import os
import re
import sys
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = '1.0.0'
PORT = int(os.environ.get('BANDLY_MCP_PORT', '8094'))
TOKEN_FILE = os.environ.get('BANDLY_MCP_TOKEN_FILE', '/root/bandly-mcp/token')
DATA = os.environ.get('BANDLY_DATA', '/root/bandly-live/data')
ROOTS = {
    'dumps': os.path.join(DATA, 'dumps'),
    'archive': os.environ.get('BANDLY_ARCHIVE', '/root/bandly-archive/dumps'),
    'reports': os.path.join(DATA, 'reports'),
    'knowledge': os.path.join(DATA, 'router-knowledge'),
}
ERRORS = os.path.join(DATA, 'errors.jsonl')
MAX_OUT = 60_000          # أقصى نص يرجع في رد واحد
MAX_SCAN_BYTES = 2_000_000  # أكبر ملف/عضو zip نفتّش محتواه
SEARCH_BUDGET_S = 25

PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']


# ───────────────────────── إخفاء الأسرار ─────────────────────────
_SECRET_KEYS = (r'imei|imsi|iccid|meid|esn|eid|serial(?:_?num(?:ber)?)?|sn|s/n|mac(?:_?addr(?:ess)?)?|'
                r'password|passwd|pwd|pass|psk|wpa_?(?:psk|key|passphrase)?|wifi_?key|wlan_?key|key|secret|'
                r'token|csrf_?token|session(?:_?id)?|sessionidentifier|securetoken|cookie|authorization|'
                r'ubus_rpc_session|stok|sysauth|nonce|salt|pin|puk|msisdn|phone(?:_?number)?|number')
_KEY = r'["\']?\b(?:' + _SECRET_KEYS + r')\b["\']?\s*[:=]\s*'
# "key":"قيمة فيها مسافات" ← لين علامة الإغلاق · key: قيمة ← لين آخر السطر/الفاصل (الكلمات ممكن فيها مسافات)
_KVQ = re.compile(r'(?i)(' + _KEY + r')(["\'])(.*?)\2')
_KV = re.compile(r'(?i)(' + _KEY + r')([^"\'&,;<>\n}\]]+)')
_XML = re.compile(r'(?i)(<(' + _SECRET_KEYS + r')>)([^<]{3,})(</\2>)')
_MAC = re.compile(r'\b([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b')
# IMEI/IMSI ١٥ · ICCID ١٩–٢٠ · أرقام جوال (05… / 9665… / 2189… / +…) — وقت ms (١٣ خانة) ورقم الخلية يبقون
_LONGNUM = re.compile(r'(?<![\w.])(?:\d{14,22}|\+?(?:9665|2189|9715|9665)\d{8}|05\d{8})(?![\w.])')
_SAFE_VALUES = {'true', 'false', 'null', 'none', 'undefined', 'enable', 'disable', 'on', 'off'}


def _mask_tail(v: str) -> str:
    return '•••' + v[-3:] if len(v) > 6 else '•••'


def scrub(text: str) -> str:
    def kv(m):
        v = m.group(2).rstrip()
        if len(v) < 3 or v.startswith('•••') or v.lower() in _SAFE_VALUES or re.fullmatch(r'-?\d{1,3}', v):
            return m.group(0)
        return m.group(1) + '•••' + m.group(2)[len(m.group(2).rstrip()):]
    def kvq(m):
        v = m.group(3)
        if len(v) < 3 or v.lower() in _SAFE_VALUES or re.fullmatch(r'-?\d{1,3}', v):
            return m.group(0)
        return m.group(1) + m.group(2) + '•••' + m.group(2)
    text = _KVQ.sub(kvq, text)
    text = _KV.sub(kv, text)
    text = _XML.sub(lambda m: m.group(1) + '•••' + m.group(4), text)
    text = _MAC.sub(lambda m: m.group(0)[:8] + ':••:••:••', text)
    text = _LONGNUM.sub(lambda m: _mask_tail(m.group(0)), text)
    return text


# ───────────────────────── المسارات ─────────────────────────
class Bad(Exception):
    pass


def resolve(pid: str) -> str:
    """«dumps/x.zip» ← مسار حقيقي داخل جذره، وإلا Bad"""
    pid = (pid or '').strip().lstrip('/')
    if pid == 'errors':
        return ERRORS
    root_key, _, rest = pid.partition('/')
    if root_key not in ROOTS or not rest:
        raise Bad('المسار لازم يبدأ بـ ' + ' / '.join(ROOTS) + ' (مثل dumps/router-X.zip)')
    root = os.path.realpath(ROOTS[root_key])
    p = os.path.realpath(os.path.join(root, rest))
    if p != root and not p.startswith(root + os.sep):
        raise Bad('مسار برا مجلدات Bandly — مرفوض')
    if not os.path.exists(p):
        raise Bad('ما لقيت: ' + pid)
    return p


def pid_of(path: str) -> str:
    rp = os.path.realpath(path)
    for k, r in ROOTS.items():
        r = os.path.realpath(r)
        if rp.startswith(r + os.sep):
            return k + '/' + os.path.relpath(rp, r)
    return '?'


def _fmt_time(t: float) -> str:
    return time.strftime('%m-%d %H:%M', time.localtime(t))


def _iter_files(keys, days=None):
    """(pid، المسار، الحجم، الوقت) لكل ملف في الجذور (المجلدات تنفتح لملفاتها)"""
    cutoff = time.time() - days * 86400 if days else 0
    for k in keys:
        root = ROOTS.get(k)
        if not root or not os.path.isdir(root):
            continue
        for dirpath, dirnames, files in os.walk(root, followlinks=False):
            dirnames[:] = [d for d in dirnames if not d.startswith('.')]
            for f in files:
                p = os.path.join(dirpath, f)
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                if st.st_mtime < cutoff:
                    continue
                yield pid_of(p), p, st.st_size, st.st_mtime


def _is_text_name(n: str) -> bool:
    return not re.search(r'\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|otf|mp[34]|bin|gz|zip|apk|exe|pdf)$', n, re.I)


def _read_bytes(path: str, member: str | None) -> bytes:
    if member:
        with zipfile.ZipFile(path) as z:
            info = z.getinfo(member)
            if info.file_size > 20_000_000:
                raise Bad('العضو كبير مرة (' + str(info.file_size) + ' بايت)')
            return z.read(member)
    if os.path.getsize(path) > 20_000_000:
        raise Bad('الملف كبير مرة')
    with open(path, 'rb') as f:
        return f.read()


def _decode(b: bytes) -> str:
    for enc in ('utf-8', 'gb18030', 'latin-1'):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            continue
    return b.decode('utf-8', 'replace')


def _cap(s: str) -> str:
    return s if len(s) <= MAX_OUT else s[:MAX_OUT] + f'\n… (انقص — {len(s)} حرف. استخدم offset أو grep)'


# ───────────────────────── الأدوات ─────────────────────────
def t_search(a):
    words = [w.lower() for w in (a.get('query') or '').split() if w.strip()]
    if not words:
        raise Bad('اكتب كلمة للبحث (مثل E5785 أو zlt x300)')
    scope = a.get('scope') or 'all'
    keys = ['dumps', 'archive', 'reports'] if scope == 'all' else [scope]
    days = a.get('days') or (14 if keys == ['reports'] else None)
    content = a.get('content', True)
    limit = min(int(a.get('limit') or 40), 200)
    t0 = time.time()
    hits = []
    for pid, p, size, mt in sorted(_iter_files(keys, days), key=lambda x: -x[3]):
        if len(hits) >= limit:
            break
        name = pid.lower()
        why = None
        if any(w in name for w in words):
            why = 'الاسم'
        elif content and time.time() - t0 < SEARCH_BUDGET_S:
            try:
                if p.endswith('.zip'):
                    with zipfile.ZipFile(p) as z:
                        for zi in z.infolist():
                            zn = zi.filename.lower()
                            if any(w in zn for w in words):
                                why = 'داخل zip: ' + zi.filename
                                break
                            if zi.file_size <= MAX_SCAN_BYTES and _is_text_name(zn) and \
                                    (zn.endswith(('router.txt', 'live.txt', 'readme.txt', 'diag.txt')) or '_bandly/' in zn):
                                t = z.read(zi).decode('utf-8', 'ignore').lower()
                                if any(w in t for w in words):
                                    why = 'محتوى ' + zi.filename
                                    break
                elif size <= MAX_SCAN_BYTES and _is_text_name(name):
                    with open(p, 'rb') as f:
                        t = f.read().decode('utf-8', 'ignore').lower()
                    if any(w in t for w in words):
                        why = 'المحتوى'
            except (zipfile.BadZipFile, OSError):
                pass
        if why:
            hits.append(f'{pid}  ·  {size:,}B  ·  {_fmt_time(mt)}  ·  {why}')
    out = f'{len(hits)} نتيجة لـ «{" ".join(words)}» ({scope}{f", آخر {days} يوم" if days else ""}):\n' + '\n'.join(hits)
    if time.time() - t0 >= SEARCH_BUDGET_S:
        out += '\n⚠️ البحث في المحتوى وقف بعد ٢٥ ثانية — النتائج ناقصة؛ ضيّق بـ scope أو days.'
    return out


def t_recent(a):
    scope = a.get('scope') or 'all'
    keys = ['dumps', 'archive', 'reports'] if scope == 'all' else [scope]
    hours = float(a.get('hours') or 24)
    limit = min(int(a.get('limit') or 50), 300)
    rows = sorted(_iter_files(keys, hours / 24), key=lambda x: -x[3])[:limit]
    return f'{len(rows)} ملف آخر {hours:g} ساعة ({scope}):\n' + '\n'.join(
        f'{pid}  ·  {size:,}B  ·  {_fmt_time(mt)}' for pid, _, size, mt in rows)


def t_zip_list(a):
    p = resolve(a.get('path'))
    if not zipfile.is_zipfile(p):
        raise Bad('مو zip')
    flt = (a.get('filter') or '').lower()
    with zipfile.ZipFile(p) as z:
        infos = [i for i in z.infolist() if not i.is_dir() and (not flt or flt in i.filename.lower())]
    lines = [f'{i.file_size:>9,}  {i.filename}' for i in infos]
    return _cap(f'{len(infos)} ملف في {pid_of(p)}:\n' + '\n'.join(lines))


def t_read(a):
    p = resolve(a.get('path'))
    member = a.get('member') or None
    if os.path.isdir(p):
        names = sorted(os.listdir(p))
        return _cap(f'{pid_of(p)} مجلد — {len(names)}:\n' + '\n'.join(names))
    if p.endswith('.zip') and not member:
        return t_zip_list({'path': a.get('path')})
    text = _decode(_read_bytes(p, member))
    grep = a.get('grep')
    if grep:
        try:
            rx = re.compile(grep, re.I)
        except re.error as e:
            raise Bad('grep غلط: ' + str(e))
        ctx = min(int(a.get('context') or 0), 5)
        lines = text.splitlines()
        keep = set()
        for i, ln in enumerate(lines):
            if rx.search(ln):
                keep.update(range(max(0, i - ctx), min(len(lines), i + ctx + 1)))
        body = '\n'.join(f'{i + 1}: {lines[i][:2000]}' for i in sorted(keep))
        head = f'{pid_of(p)}{" ← " + member if member else ""} · {len(keep)} سطر يطابق «{grep}»\n'
        return _cap(head + scrub(body))
    off = max(int(a.get('offset') or 0), 0)
    n = min(int(a.get('max_chars') or 20000), MAX_OUT)
    chunk = text[off:off + n]
    tail = f'\n… (باقي {len(text) - off - n} حرف — offset={off + n})' if off + n < len(text) else ''
    return f'{pid_of(p)}{" ← " + member if member else ""} · {len(text)} حرف\n' + scrub(chunk) + tail


def t_errors(a):
    if not os.path.exists(ERRORS):
        return 'ما فيه errors.jsonl'
    hours = float(a.get('hours') or 24)
    cutoff = time.time() - hours * 3600
    grep = (a.get('grep') or '').lower()
    limit = min(int(a.get('limit') or 60), 400)
    size = os.path.getsize(ERRORS)
    with open(ERRORS, 'rb') as f:
        f.seek(max(0, size - 8_000_000))
        lines = f.read().decode('utf-8', 'ignore').splitlines()
    out = []
    for ln in reversed(lines):
        try:
            j = json.loads(ln)
        except ValueError:
            continue
        ts = j.get('ts') or j.get('time') or j.get('t') or 0
        try:
            ts = float(ts) / (1000 if float(ts) > 1e12 else 1)
        except (TypeError, ValueError):
            ts = 0
        if ts and ts < cutoff:
            break
        if grep and grep not in ln.lower():
            continue
        out.append(ln[:1500])
        if len(out) >= limit:
            break
    return _cap(f'{len(out)} خطأ (آخر {hours:g} ساعة{", يطابق " + grep if grep else ""}، الأحدث أول):\n' + scrub('\n'.join(out)))


TOOLS = [
    ('search_files', t_search, 'دوّر في ملفات أعضاء Bandly على الرسيفر (dumps + الأرشيف + التقارير) بالاسم أو المحتوى — نفس dumps-link.sh. الأحدث أول.', {
        'query': {'type': 'string', 'description': 'كلمة أو أكثر (مثل «E5785» أو «zlt x300» أو تاريخ الاسم 1127)'},
        'scope': {'type': 'string', 'enum': ['all', 'dumps', 'archive', 'reports', 'knowledge'], 'description': 'الافتراضي all'},
        'days': {'type': 'number', 'description': 'آخر كم يوم (اختياري)'},
        'content': {'type': 'boolean', 'description': 'يدوّر في المحتوى كمان (الافتراضي نعم)'},
        'limit': {'type': 'number'},
    }, ['query']),
    ('list_recent', t_recent, 'آخر الملفات اللي وصلت (dumps / archive / reports).', {
        'scope': {'type': 'string', 'enum': ['all', 'dumps', 'archive', 'reports', 'knowledge']},
        'hours': {'type': 'number', 'description': 'الافتراضي ٢٤'},
        'limit': {'type': 'number'},
    }, []),
    ('zip_list', t_zip_list, 'محتوى zip (أسماء الملفات وأحجامها).', {
        'path': {'type': 'string', 'description': 'مثل dumps/router-ZTE-FULL-1109-103909.zip'},
        'filter': {'type': 'string', 'description': 'جزء من الاسم (اختياري)'},
    }, ['path']),
    ('read_file', t_read, 'يقرأ ملف أو ملف داخل zip (نص، الأسرار مخفية). grep يطلّع السطور المطابقة بس (regex).', {
        'path': {'type': 'string', 'description': 'dumps/… · archive/… · reports/… · knowledge/… · errors'},
        'member': {'type': 'string', 'description': 'اسم الملف داخل الـ zip (مثل _bandly/diag.txt)'},
        'grep': {'type': 'string', 'description': 'regex (اختياري)'},
        'context': {'type': 'number', 'description': 'سطور حول كل تطابق (٠–٥)'},
        'offset': {'type': 'number'},
        'max_chars': {'type': 'number'},
    }, ['path']),
    ('recent_errors', t_errors, 'آخر أخطاء التطبيق من errors.jsonl (add-login وغيرها).', {
        'hours': {'type': 'number', 'description': 'الافتراضي ٢٤'},
        'grep': {'type': 'string', 'description': 'كلمة (موديل/نوع)'},
        'limit': {'type': 'number'},
    }, []),
]
TOOL_FN = {n: f for n, f, *_ in TOOLS}


def tools_list():
    return [{'name': n, 'description': d, 'inputSchema': {'type': 'object', 'properties': props, 'required': req},
             'annotations': {'readOnlyHint': True, 'destructiveHint': False, 'openWorldHint': False}}
            for n, _, d, props, req in TOOLS]


# ───────────────────────── MCP (JSON-RPC) ─────────────────────────
def handle_rpc(msg):
    """رسالة JSON-RPC وحدة ← رد (أو None للإشعارات)"""
    if not isinstance(msg, dict):
        return {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Invalid Request'}}
    mid = msg.get('id')
    method = msg.get('method') or ''
    if mid is None:
        return None  # إشعار (notifications/initialized …)
    ok = lambda r: {'jsonrpc': '2.0', 'id': mid, 'result': r}
    if method == 'initialize':
        want = (msg.get('params') or {}).get('protocolVersion')
        return ok({
            'protocolVersion': want if want in PROTOCOLS else PROTOCOLS[0],
            'capabilities': {'tools': {'listChanged': False}},
            'serverInfo': {'name': 'bandly-receiver', 'title': 'الرسيفر — ملفات Bandly (قراءة بس)', 'version': VERSION},
            'instructions': 'ملفات أعضاء Bandly على الرسيفر (قراءة بس، الأسرار مخفية). ابدأ بـ search_files أو list_recent، '
                            'وبعدها zip_list و read_file (member=_bandly/diag.txt · router.txt · live.txt).',
        })
    if method == 'ping':
        return ok({})
    if method == 'tools/list':
        return ok({'tools': tools_list()})
    if method == 'tools/call':
        p = msg.get('params') or {}
        fn = TOOL_FN.get(p.get('name'))
        if not fn:
            return {'jsonrpc': '2.0', 'id': mid, 'error': {'code': -32602, 'message': 'أداة غير معروفة'}}
        try:
            text = fn(p.get('arguments') or {})
            return ok({'content': [{'type': 'text', 'text': text}], 'isError': False})
        except Bad as e:
            return ok({'content': [{'type': 'text', 'text': str(e)}], 'isError': True})
        except Exception as e:  # noqa: BLE001 — نرجّع الخطأ للجلسة بدل ما يطيح الخادم
            return ok({'content': [{'type': 'text', 'text': f'خطأ: {type(e).__name__}: {e}'}], 'isError': True})
    if method in ('resources/list', 'prompts/list'):
        return ok({method.split('/')[0]: []})
    return {'jsonrpc': '2.0', 'id': mid, 'error': {'code': -32601, 'message': 'Method not found: ' + method}}


def load_token() -> str:
    try:
        with open(TOKEN_FILE) as f:
            t = f.read().strip()
        return t if len(t) >= 24 else ''
    except OSError:
        return ''


class H(BaseHTTPRequestHandler):
    server_version = 'bandly-mcp'
    sys_version = ''

    def _authed(self) -> bool:
        tok = load_token()
        path = self.path.split('?')[0].strip('/')
        # nginx: /claude-mcp/<token>[/mcp] ← هنا /<token>[/mcp]
        parts = path.split('/')
        return bool(tok) and len(parts) >= 1 and parts[0] == tok and (len(parts) == 1 or parts[1:] == ['mcp'])

    def _send(self, code, body=b'', ctype='application/json', extra=None):
        self.send_response(code)
        if body:
            self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        if not self._authed():
            return self._send(404)
        self._send(405, extra={'Allow': 'POST'})

    def do_DELETE(self):
        self._send(404 if not self._authed() else 405, extra={'Allow': 'POST'})

    def do_POST(self):
        if not self._authed():
            return self._send(404)
        n = int(self.headers.get('Content-Length') or 0)
        if n > 1_000_000:
            return self._send(413)
        try:
            msg = json.loads(self.rfile.read(n) or b'null')
        except ValueError:
            return self._send(400, json.dumps({'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'Parse error'}}).encode())
        if isinstance(msg, list):
            res = [r for r in (handle_rpc(m) for m in msg) if r is not None]
        else:
            res = handle_rpc(msg)
        if not res:
            return self._send(202)
        if isinstance(msg, dict) and msg.get('method') == 'tools/call':
            name = (msg.get('params') or {}).get('name')
            print(f'[mcp] {time.strftime("%H:%M:%S")} {name} {json.dumps((msg.get("params") or {}).get("arguments") or {}, ensure_ascii=False)[:200]}', flush=True)
        self._send(200, json.dumps(res, ensure_ascii=False).encode('utf-8'))

    def log_message(self, fmt, *args):  # سجل خفيف بدون الرابط (فيه الرمز)
        return


def main():
    if not load_token():
        print('ما فيه رمز في ' + TOKEN_FILE + ' — شغّل install.sh', file=sys.stderr)
        sys.exit(1)
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), H)
    print(f'[mcp] bandly-receiver {VERSION} على 127.0.0.1:{PORT}', flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
