/** ZTE فايبر F660 — صفحة الدخول الحقيقية (ملفات عضو ١٥ نوفمبر) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare const require: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
const { isZtOntLogin, ztOntModel, ztOntCheckToken, ztOntLoginToken, ztOntLocked, ztOntError, ztOntBody, ztOntPassword, ZT_DANGER } = require('../src/drivers/ztont/parse');

const page = fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'ztont', 'f660-login.html'), 'utf8');

test('F660: التعرّف والموديل والرمز', () => {
  assert.ok(isZtOntLogin(page));
  assert.equal(ztOntModel(page), 'F660');
  assert.equal(ztOntCheckToken(page), '80758875764902644745');
  assert.equal(ztOntLoginToken(page), '3');
  assert.equal(ztOntLocked(page), false);   // تعريف SetDisabled بس — ما فيه نداء
  assert.equal(ztOntError(page), null);
  assert.ok(!isZtOntLogin('<html><frameset><frame src="top.gch"></frameset></html>'));
});

test('F660: جسم الدخول = passwordSHA256() في الصفحة', () => {
  const b = new URLSearchParams(ztOntBody('admin', 'pass1234', '80758875764902644745', '3', 12345678));
  assert.equal(b.get('action'), 'login');
  assert.equal(b.get('Username'), 'admin');
  assert.equal(b.get('Password'), ztOntPassword('pass1234', 12345678));
  assert.equal(b.get('Password'), '5992e4de6d8b39cf2427101bc03e44957a88f556fc6785473dc22a20edd9e94d'); // sha256('pass1234'+'12345678')
  assert.equal(b.get('Frm_Logintoken'), '3');
  assert.equal(b.get('UserRandomNum'), '12345678');
  assert.equal(b.get('Frm_Loginchecktoken'), '80758875764902644745');
});

test('F660: القفل والخطأ ومسارات خطر', () => {
  assert.equal(ztOntLocked(page + '<script>SetDisabled();</script>'), true);
  assert.equal(ztOntError('getObj("errmsg").innerHTML = "The username or password is not correct.";'), 'The username or password is not correct.');
  assert.ok(ZT_DANGER.test('/getpage.gch?pid=1002&nextpage=manager_dev_restart_t.gch'));
  assert.ok(!ZT_DANGER.test('/getpage.gch?pid=1002&nextpage=pon_status_link_info_t.gch'));
});
