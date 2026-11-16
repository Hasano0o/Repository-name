#!/usr/bin/env python3
"""
سيرفر مسرّع Bandly — المرحلة ١ («هل يفيدك مسرّع؟»). بدون أي مكتبة خارجية.
  GET /ping    ← رد فاضي سريع: التطبيق يقيس فيه العضو ← سيرفرنا
  GET /routes  ← آخر قياس: سيرفرنا ← سيرفرات الألعاب (كل منطقة) — يتحدث كل دقيقتين
يشتغل على 127.0.0.1:8099 وCaddy قدامه بشهادة HTTPS (الآيفون ما يقبل http).
المناطق من regions.json (نفس src/utils/latency.ts في التطبيق).
"""
import http.client
import json
import random
import socket
import ssl
import statistics
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
REGIONS = json.loads((HERE / "regions.json").read_text())
EVERY = 120
SAMPLES = 10
CTX = ssl.create_default_context()
state = {"at": 0, "regions": {}}


class V4Conn(http.client.HTTPSConnection):
    """IPv4 بس — بعض السيرفرات ما عندها مسار IPv6 سليم ويطلع البنق غلط"""
    def connect(self):
        host = socket.getaddrinfo(self.host, self.port, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
        sock = socket.create_connection((host, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _req(conn, path, timeout):
    conn.timeout = timeout
    # لو السيرفر قفل الاتصال (Connection: close) نفتحه قبل التوقيت — نقيس الرحلة بس، مو فتح TLS
    if conn.sock is None:
        conn.connect()
    conn.sock.settimeout(timeout)
    sep = "&" if "?" in path else "?"
    t0 = time.perf_counter()
    conn.request("GET", f"{path}{sep}r={random.randrange(1 << 30):x}", headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})
    r = conn.getresponse()
    ms = (time.perf_counter() - t0) * 1000
    r.read()
    return ms


def measure(urls, n=SAMPLES, timeout=3.0):
    """نفس طريقة التطبيق: نجرب الأول والبدائل، تسخينتين، بعدها n قياس على نفس الاتصال"""
    for u in urls:
        p = urlsplit(u)
        path = p.path or "/"
        if p.query:
            path += "?" + p.query
        conn = V4Conn(p.hostname, p.port or 443, timeout=timeout, context=CTX)
        try:
            _req(conn, path, timeout)
            _req(conn, path, timeout)
        except Exception:
            conn.close()
            continue
        vals, lost = [], 0
        for _ in range(n):
            try:
                vals.append(_req(conn, path, timeout))
            except Exception:
                lost += 1
                conn.close()
                conn = V4Conn(p.hostname, p.port or 443, timeout=timeout, context=CTX)
            time.sleep(0.12)
        conn.close()
        if not vals:
            continue
        jit = round(statistics.mean(abs(a - b) for a, b in zip(vals, vals[1:]))) if len(vals) > 1 else 0
        return {"median": round(sorted(vals)[len(vals) // 2]), "min": round(min(vals)), "jitter": jit,
                "lossPct": round(100 * lost / n), "samples": len(vals), "host": p.hostname}
    return {"median": 0, "jitter": 0, "lossPct": 100, "samples": 0}


def loop():
    while True:
        out = {}
        for rid, urls in REGIONS.items():
            try:
                out[rid] = measure(urls)
            except Exception as e:
                out[rid] = {"median": 0, "jitter": 0, "lossPct": 100, "samples": 0, "err": str(e)[:80]}
        state.update(at=int(time.time()), regions=out)
        time.sleep(EVERY)


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, body=b"", ctype="text/plain"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/ping", "/"):
            self._send(200, b"ok")
        elif path == "/routes":
            self._send(200, json.dumps(state, ensure_ascii=False).encode(), "application/json")
        else:
            self._send(404, b"no")

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    threading.Thread(target=loop, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", 8099), H).serve_forever()
