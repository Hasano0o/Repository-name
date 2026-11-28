#!/usr/bin/env python3
"""اختبارات موصّل الرسيفر: python3 live-server/mcp/test_bandly_mcp.py"""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
import zipfile

TMP = tempfile.mkdtemp()
os.environ['BANDLY_DATA'] = os.path.join(TMP, 'data')
os.environ['BANDLY_ARCHIVE'] = os.path.join(TMP, 'archive')
os.environ['BANDLY_MCP_TOKEN_FILE'] = os.path.join(TMP, 'token')
os.environ['BANDLY_MCP_PORT'] = '18094'
TOKEN = 'a' * 48
for d in ('data/dumps', 'data/reports', 'archive'):
    os.makedirs(os.path.join(TMP, d))
open(os.path.join(TMP, 'token'), 'w').write(TOKEN)
open(os.path.join(TMP, 'secret.txt'), 'w').write('سر برا المجلدات')
with zipfile.ZipFile(os.path.join(TMP, 'data/dumps/router-Huawei-FULL-1128-0930.zip'), 'w') as z:
    z.writestr('_bandly/router.txt', 'model: E5785-320a\nimei: 861466070254199\nsoftware: 11.0.2.1')
    z.writestr('_bandly/diag.txt', 'GET /api/device/signal 200\n<rsrp>-95dBm</rsrp>\n<SerialNumber>NNKUT24131002896</SerialNumber>\nPOST /api/user/login 200')
    z.writestr('html/index.html', '<html>hi</html>')
open(os.path.join(TMP, 'data/reports/bandly-add-login-1128-0931.txt'), 'w').write('E5785 login failed\nWifiKey: neny R9tq4a4\npassword=admin123\n')
open(os.path.join(TMP, 'archive/router-ZLT-1101-1200.zip'), 'wb').write(b'not a zip')
open(os.path.join(TMP, 'data/errors.jsonl'), 'w').write(json.dumps({'ts': 4102444800, 'kind': 'add-login', 'model': 'E5785', 'msg': 'رفض'}) + '\n')

sys.path.insert(0, os.path.dirname(__file__))
import bandly_mcp as M  # noqa: E402


class Scrub(unittest.TestCase):
    def test_secrets(self):
        t = M.scrub('imei: 861466070254199 · IMEI=861466070254199 "WifiKey":"neny R9tq4a4" password=admin '
                    '<SerialNumber>NNKUT24131002896</SerialNumber> mac aa:bb:cc:11:22:33 sms from 0562294460 iccid 89966012345678901234')
        for leak in ('861466070254199', 'neny', 'admin', 'NNKUT24131002896', '11:22:33', '0562294460', '89966012345678901234'):
            self.assertNotIn(leak, t, leak)
        self.assertIn('aa:bb:cc', t)

    def test_keeps_readings(self):
        t = M.scrub('rsrp=-95 sinr: 12 pci=148 cell_id 283930 ts 1764311234567 band: 3 enable=1 "key":true')
        for keep in ('-95', '12', '148', '283930', '1764311234567', 'band: 3', '"key":true'):
            self.assertIn(keep, t, keep)


class Paths(unittest.TestCase):
    def test_escape_blocked(self):
        for bad in ('dumps/../../secret.txt', '../secret.txt', '/etc/passwd', 'etc/passwd', 'reports/../../../secret.txt', 'dumps'):
            with self.assertRaises(M.Bad, msg=bad):
                M.resolve(bad)

    def test_ok(self):
        self.assertTrue(M.resolve('dumps/router-Huawei-FULL-1128-0930.zip').endswith('.zip'))
        self.assertEqual(M.resolve('errors'), M.ERRORS)


class Tools(unittest.TestCase):
    def call(self, name, **a):
        r = M.handle_rpc({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': name, 'arguments': a}})
        return r['result']['content'][0]['text'], r['result']['isError']

    def test_search_name_and_content(self):
        t, err = self.call('search_files', query='E5785')
        self.assertFalse(err)
        self.assertIn('dumps/router-Huawei-FULL-1128-0930.zip', t)   # من router.txt داخل الـ zip
        self.assertIn('reports/bandly-add-login-1128-0931.txt', t)
        t, _ = self.call('search_files', query='zlt')
        self.assertIn('archive/router-ZLT-1101-1200.zip', t)          # zip خربان — الاسم يكفي

    def test_read_scrubbed(self):
        t, err = self.call('read_file', path='dumps/router-Huawei-FULL-1128-0930.zip', member='_bandly/router.txt')
        self.assertFalse(err)
        self.assertIn('E5785-320a', t)
        self.assertNotIn('861466070254199', t)
        t, _ = self.call('read_file', path='dumps/router-Huawei-FULL-1128-0930.zip', member='_bandly/diag.txt', grep='serial|rsrp')
        self.assertIn('-95dBm', t)
        self.assertNotIn('NNKUT', t)
        t, _ = self.call('read_file', path='reports/bandly-add-login-1128-0931.txt')
        self.assertNotIn('admin123', t)
        self.assertNotIn('R9tq4a4', t)

    def test_zip_list_recent_errors(self):
        t, _ = self.call('zip_list', path='dumps/router-Huawei-FULL-1128-0930.zip')
        self.assertIn('_bandly/diag.txt', t)
        t, _ = self.call('list_recent', hours=1)
        self.assertIn('reports/bandly-add-login-1128-0931.txt', t)
        t, _ = self.call('recent_errors', grep='e5785')
        self.assertIn('add-login', t)

    def test_bad_path_is_tool_error(self):
        t, err = self.call('read_file', path='dumps/../../secret.txt')
        self.assertTrue(err)
        self.assertNotIn('سر', t)


class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = M.ThreadingHTTPServer(('127.0.0.1', 18094), M.H)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def post(self, path, body):
        req = urllib.request.Request('http://127.0.0.1:18094' + path, data=json.dumps(body).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def test_token_required(self):
        self.assertEqual(self.post('/wrong', {'jsonrpc': '2.0', 'id': 1, 'method': 'ping'})[0], 404)
        self.assertEqual(self.post('/', {'jsonrpc': '2.0', 'id': 1, 'method': 'ping'})[0], 404)

    def test_handshake(self):
        c, b = self.post('/' + TOKEN, {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                                        'params': {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 't', 'version': '1'}}})
        self.assertEqual(c, 200)
        j = json.loads(b)
        self.assertEqual(j['result']['protocolVersion'], '2025-06-18')
        self.assertEqual(self.post('/' + TOKEN, {'jsonrpc': '2.0', 'method': 'notifications/initialized'})[0], 202)
        c, b = self.post('/' + TOKEN + '/mcp', {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'})
        names = [t['name'] for t in json.loads(b)['result']['tools']]
        self.assertEqual(names, ['search_files', 'list_recent', 'zip_list', 'read_file', 'recent_errors'])


if __name__ == '__main__':
    unittest.main(verbosity=1)
