/* 用 JS 引擎生成各输出格式，供与 Python 版逐字节对照。
 * 用法: node run_js.js <input.txt> <outPrefix>
 */
const fs = require('fs');
const path = require('path');
const S = require('../engine.js');

const input = fs.readFileSync(process.argv[2], 'utf8');
const prefix = process.argv[3];
const TD = path.join(__dirname, '..', 'testdata');
const providerUrl = 'https://jmssub.net/members/getsub.php?service=1454501&id=test';

const targets = ['clash', 'provider', 'base64', 'node-list', 'surge'];
let first = true;

targets.forEach(function (target) {
  const r = S.convert(input, {
    sort: true,
    target: target,
    providerUrl: providerUrl,
    providerName: 'proxy-sub',
    providerUa: S.DEFAULT_UA,
    mixedPort: 7890,
  });
  if (first) {
    console.error('  JS  → 节点 ' + r.stats.total + '  ' + JSON.stringify(r.stats.types));
    first = false;
  }
  fs.writeFileSync(path.join(TD, prefix + '_' + target.replace('-', '') + '.txt'), r.text, 'utf8');
});
