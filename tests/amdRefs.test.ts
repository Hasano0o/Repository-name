import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amdBaseOf, findAmdRefs } from '../src/services/amdRefs';

test('RequireJS: data-main وأسماء الموديولات تتحول لملفات (ZTE U30 Pro)', () => {
  const html = '<script src="js/require/require.js" data-main="js/main"></script>';
  assert.equal(amdBaseOf(html), 'js/');
  assert.deepEqual(findAmdRefs(html, 'js/'), ['js/main.js']);
  const main = "require.config({baseUrl:'js',paths:{jq:'lib/jquery'}});require(['service','view/home','text!tmpl/home.html','css!x'],function(){});";
  assert.equal(amdBaseOf(main), 'js/');
  assert.deepEqual(findAmdRefs(main, 'js/').sort(), ['js/lib/jquery.js', 'js/service.js', 'js/tmpl/home.html', 'js/view/home.js'].sort());
});
