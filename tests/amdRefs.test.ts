import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAmdConfig, idToFile, findAmdIds } from '../src/services/amdRefs';

// من ملفات ZTE U30 Pro الحقيقية (٢٥ أكتوبر)
const html = '<script type="text/javascript" data-main="js/main" src="js/lib/require/require.js?v=1"></script>';
const requireJs = 'g={waitSeconds:7,baseUrl:"./",paths:{}};req.config=function(e){return req(e)}';
const mainJs = 'require.config({paths:{text:"lib/require/text",tmpl:"../tmpl",jquery:"lib/jquery/jquery-3.6.1.min",base64:"lib/base64"},shim:{util:["jquery"]},urlArgs:"v="+(new Date).getTime()}),require(["bootstrap","service","config/config","util",zte_web_ui_is_test?"simulate":""],function(e,i,t){o({menu:"config/"+t.DEVICE+"/menu"});require(["app","jq_additional"])});';

const files = (ids: string[], cfg: any) => ids.map(i => idToFile(i, cfg)).filter(Boolean).sort();

test('RequireJS: baseUrl من data-main — مو من require.js (اللي فيه baseUrl:"./")', () => {
  let cfg = readAmdConfig(html, null);
  assert.equal(cfg!.base, 'js/');
  cfg = readAmdConfig(requireJs, cfg);
  assert.equal(cfg!.base, 'js/');
  assert.deepEqual(files(findAmdIds(html, '/'), cfg), ['js/main.js']);
});

test('RequireJS: main.js ← service/config/util/app + paths (tmpl:"../tmpl")', () => {
  let cfg = readAmdConfig(html, null);
  cfg = readAmdConfig(mainJs, cfg)!;
  assert.equal(cfg.paths.tmpl, '../tmpl');
  const f = files(findAmdIds(mainJs, '/js/main.js'), cfg);
  for (const want of ['js/service.js', 'js/config/config.js', 'js/util.js', 'js/app.js', 'js/simulate.js', 'js/lib/jquery/jquery-3.6.1.min.js']) {
    assert.ok(f.includes(want), want);
  }
  assert.equal(idToFile('text!tmpl/wifi/ssid.html', cfg), 'js/../tmpl/wifi/ssid.html');
  assert.equal(idToFile('css!x', cfg), null);
});

test('ZTE: DEVICE في config.js ← قوائم الجهاز، وملف القائمة ← صفحاته', () => {
  const cfg = { base: 'js/', paths: {} };
  const f = files(findAmdIds('define({DEVICE:"ufi",PRODUCT_TYPE:"UFI"})', '/js/config/config.js'), cfg);
  assert.ok(f.includes('js/config/ufi/menu.js'));
  assert.ok(f.includes('js/config/ufi/config.js'));
  const menu = files(findAmdIds('define(function(){return [{hash:"#wifi_main_ssid",path:"wifi/ssid"},{hash:"#home",path:"home/home"}]})', '/js/config/ufi/menu.js'), cfg);
  assert.ok(menu.includes('js/wifi/ssid.js'));
  assert.ok(menu.includes('js/home/home.js'));
});

test('ZTE: DEVICE بصيغة الإسناد (config.DEVICE = "...") بعد', () => {
  const cfg = { base: 'js/', paths: {} };
  const f = findAmdIds('define(["jquery"],function(){var config={};config.DEVICE = "u30pro";return config})', '/js/config/config.js').map(i => idToFile(i, cfg));
  assert.ok(f.includes('js/config/u30pro/menu.js'));
});
