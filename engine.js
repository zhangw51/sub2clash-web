/* ============================================================================
 * sub2clash 纯前端引擎（JavaScript 移植版）
 *
 * 与 Python 版 sub2clash.py 逐字段对齐：解析 8 种协议 → 生成 Clash / provider /
 * Base64 / 节点列表 / Surge。零依赖，浏览器与 Node 均可运行。
 *
 * 之所以能纯前端跑：整个转换过程只有「base64 解码 + URI 解析 + 字符串拼装」，
 * 不涉及任何服务端能力。
 * ========================================================================== */

var Sub2Clash = (function () {
  'use strict';

  var DEFAULT_UA = 'clash-verge/v2.4.2';
  var TEST_URL = 'https://www.gstatic.com/generate_204';

  /* ---------------------------------------------------------------------- *
   * 一、基础工具
   * ---------------------------------------------------------------------- */

  /** 宽松 base64 解码：兼容 urlsafe、补 padding、容错非法字符。
   *  注意：部分机场把 base64 直接塞进 query string，其中的 '+' 会被标准解析器
   *  还原成空格，这里统一把空格还原为 '+' 再解码。 */
  function b64d(s) {
    s = String(s == null ? '' : s).trim()
      .replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
    s = s.replace(/[\n\r]/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
    var pad = (4 - (s.length % 4)) % 4;
    s += '='.repeat(pad);
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var bin = atob(s);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);   // 非法字节 → U+FFFD
      } catch (e) {
        if (s.slice(-1) === '=') s = s.slice(0, -1);
        else break;
      }
    }
    return '';
  }

  /** 容错 percent-decode（Python urllib.unquote 的对应物）。 */
  function unq(s) {
    if (s == null || s === '') return '';
    try { return decodeURIComponent(s); } catch (e) { /* 继续降级 */ }
    try { return decodeURIComponent(String(s).replace(/%(?![0-9A-Fa-f]{2})/g, '%25')); }
    catch (e) { /* 继续降级 */ }
    return String(s);
  }

  /** 宽容的 query string 解析：只做 percent-decode，**不把 '+' 转成空格**。
   *  订阅链接里的 pbk / obfsparam / remarks 常常是裸 base64，
   *  标准 URLSearchParams 的 '+'→' ' 会破坏它们。 */
  function pqs(qs) {
    var out = {};
    String(qs == null ? '' : qs).split('&').forEach(function (part) {
      if (!part) return;
      var i = part.indexOf('=');
      var k = i === -1 ? part : part.slice(0, i);
      var v = i === -1 ? '' : part.slice(i + 1);
      var key = unq(k);
      if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = [];
      out[key].push(unq(v));
    });
    return out;
  }

  /** 取第一个「存在且非空」的参数值（对应 Python 的 q()）。 */
  function q(params) {
    for (var i = 1; i < arguments.length; i++) {
      var v = params[arguments[i]];
      if (v && v.length && v[0] !== '') return v[0];
    }
    return '';
  }

  function toBool(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  }

  /** 严格整数（对应 Python int()）：不合法且给了默认值就返回默认值，否则抛错。 */
  function toInt(v, def) {
    if (v === undefined || v === null || v === '') {
      if (arguments.length > 1) return def;
      throw new Error('empty number');
    }
    var s = String(v).trim();
    if (!/^[+-]?\d+$/.test(s)) {
      if (arguments.length > 1) return def;
      throw new Error('invalid number: ' + v);
    }
    return parseInt(s, 10);
  }

  function isBase64Blob(text) {
    var t = String(text).replace(/\s+/g, '');
    if (t.length < 16 || /:\/\//.test(text)) return false;
    return /^[A-Za-z0-9+/=_-]+$/.test(t);
  }

  /* ---------------------------------------------------------------------- *
   * 二、URL 拆分（模拟 Python urlsplit 的关键行为）
   * ---------------------------------------------------------------------- */

  function splitUrl(uri) {
    var m = /^([A-Za-z][A-Za-z0-9+.\-]*):\/\/([\s\S]*)$/.exec(uri);
    if (!m) return null;
    var scheme = m[1].toLowerCase();
    var rest = m[2];

    var fragment = '';
    var hi = rest.indexOf('#');
    if (hi !== -1) { fragment = rest.slice(hi + 1); rest = rest.slice(0, hi); }

    var query = '';
    var qi = rest.indexOf('?');
    if (qi !== -1) { query = rest.slice(qi + 1); rest = rest.slice(0, qi); }

    var username = '', password = '', hostport = rest;
    var ai = rest.lastIndexOf('@');
    if (ai !== -1) {
      var ui = rest.slice(0, ai);
      hostport = rest.slice(ai + 1);
      var ci = ui.indexOf(':');
      if (ci === -1) username = ui;
      else { username = ui.slice(0, ci); password = ui.slice(ci + 1); }
    }

    var host = '', port = '';
    if (hostport.charAt(0) === '[') {                  // IPv6 字面量
      var ei = hostport.indexOf(']');
      if (ei !== -1) {
        host = hostport.slice(0, ei + 1).replace(/^\[+|\]+$/g, '');
        var after = hostport.slice(ei + 1);
        if (after.charAt(0) === ':') port = after.slice(1);
      } else {
        host = hostport;
      }
    } else {
      var pi = hostport.lastIndexOf(':');
      if (pi !== -1) { host = hostport.slice(0, pi); port = hostport.slice(pi + 1); }
      else host = hostport;
    }

    return {
      scheme: scheme,
      username: username,
      password: password,
      hostname: host.toLowerCase(),                  // Python .hostname 会小写化
      port: port,
      query: query,
      fragment: fragment,
    };
  }

  /** f-string 里的 None → "None" */
  function portLabel(p) {
    return (p === '' || p === undefined || p === null) ? 'None' : p;
  }

  /* ---------------------------------------------------------------------- *
   * 三、YAML 序列化（自实现，避免任何依赖）
   * ---------------------------------------------------------------------- */

  var RESERVED = /^(?:true|false|null|yes|no|on|off|~|none)$/i;
  // YAML 保留指示符：出现在开头必须加引号（* 是别名、& 是锚点、! 是标签……）
  var INDICATORS = '-?:,[]{}#&*!|>\'"%@`';
  // 看起来像数字/特殊值的一律按字符串加引号，避免 0x1f / 1e5 / .inf 被当成数字
  var NUM_LIKE = new RegExp(
    '^[+-]?(?:[0-9][0-9_]*)(?:\\.[0-9_]*)?(?:[eE][+-]?[0-9]+)?$' +
    '|^0[xXoObB][0-9a-fA-F_]+$' +
    '|^[+-]?\\.(?:inf|Inf|INF)$|^\\.(?:nan|NaN|NAN)$'
  );

  function needsQuote(s) {
    if (s === '' || s !== s.trim()) return true;
    if (INDICATORS.indexOf(s.charAt(0)) !== -1) return true;
    if (s.indexOf(': ') !== -1 || s.indexOf(' #') !== -1 || s.charAt(s.length - 1) === ':') return true;
    if (/[\n\r\t]/.test(s)) return true;
    if (RESERVED.test(s) || NUM_LIKE.test(s)) return true;
    return false;
  }

  function scalar(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    var s = String(v);
    if (!needsQuote(s)) return s;
    var esc = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    return '"' + esc + '"';
  }

  function isMap(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function sizeOf(v) {
    if (Array.isArray(v)) return v.length;
    if (isMap(v)) return Object.keys(v).length;
    return 0;
  }

  function dumpNode(obj, ind) {
    var sp = '  '.repeat(ind);
    var out = [];

    if (Array.isArray(obj)) {
      obj.forEach(function (v) {
        if (isMap(v) && Object.keys(v).length) {
          Object.keys(v).forEach(function (k, i) {
            var pre = (i === 0 ? sp + '- ' : sp + '  ');
            var val = v[k];
            if ((isMap(val) || Array.isArray(val)) && sizeOf(val)) {
              out.push(pre + k + ':');
              out = out.concat(dumpNode(val, ind + 2));
            } else if (isMap(val) || Array.isArray(val)) {
              out.push(pre + k + ': ' + (Array.isArray(val) ? '[]' : '{}'));
            } else {
              out.push(pre + k + ': ' + scalar(val));
            }
          });
        } else if (Array.isArray(v) && v.length) {
          out.push(sp + '-');
          out = out.concat(dumpNode(v, ind + 1));
        } else {
          out.push(sp + '- ' + scalar(v));
        }
      });
      return out;
    }

    if (isMap(obj)) {
      Object.keys(obj).forEach(function (k) {
        var v = obj[k];
        if ((isMap(v) || Array.isArray(v)) && sizeOf(v)) {
          out.push(sp + k + ':');
          out = out.concat(dumpNode(v, ind + 1));
        } else if (isMap(v) || Array.isArray(v)) {
          out.push(sp + k + ': ' + (Array.isArray(v) ? '[]' : '{}'));
        } else {
          out.push(sp + k + ': ' + scalar(v));
        }
      });
    }
    return out;
  }

  function dumpYaml(obj) {
    return dumpNode(obj, 0).join('\n') + '\n';
  }

  /* ---------------------------------------------------------------------- *
   * 四、各协议解析器
   * ---------------------------------------------------------------------- */

  function parseSs(uri) {
    var body = uri.slice(5);
    var name = '';
    var h = body.indexOf('#');
    if (h !== -1) { name = unq(body.slice(h + 1)); body = body.slice(0, h); }

    var plugin = '';
    var qi = body.indexOf('?');
    if (qi !== -1) {
      plugin = (pqs(body.slice(qi + 1)).plugin || [''])[0];
      body = body.slice(0, qi);
    }
    body = body.replace(/\/+$/, '');

    var userinfo, hostport;
    if (body.indexOf('@') !== -1) {
      var ai = body.lastIndexOf('@');
      userinfo = body.slice(0, ai);
      hostport = body.slice(ai + 1);
      if (userinfo.indexOf(':') === -1) userinfo = b64d(userinfo);
    } else {
      var dec = b64d(body);
      if (dec.indexOf('@') === -1) return null;
      var di = dec.lastIndexOf('@');
      userinfo = dec.slice(0, di);
      hostport = dec.slice(di + 1);
    }
    if (userinfo.indexOf(':') === -1 || hostport.indexOf(':') === -1) return null;

    var ci = userinfo.indexOf(':');
    var method = userinfo.slice(0, ci);
    var password = userinfo.slice(ci + 1);
    var pi = hostport.lastIndexOf(':');
    var host = hostport.slice(0, pi);
    var port = hostport.slice(pi + 1);

    var node = {
      name: name || ('SS-' + host + ':' + port),
      type: 'ss',
      server: host.replace(/^\[+|\]+$/g, ''),        // Python str.strip('[]')
      port: toInt(port),
      cipher: method,
      password: password,
      udp: true,
    };

    if (plugin) {
      var p = unq(plugin);
      var opts = {};
      p.split(';').forEach(function (x) {
        var i = x.indexOf('=');
        if (i !== -1) opts[x.slice(0, i)] = x.slice(i + 1);
      });
      if (p.indexOf('obfs') === 0) {
        node.plugin = 'obfs';
        node['plugin-opts'] = { mode: opts.obfs || 'http', host: opts['obfs-host'] || '' };
      } else if (p.indexOf('v2ray-plugin') === 0) {
        node.plugin = 'v2ray-plugin';
        node['plugin-opts'] = {
          mode: 'websocket',
          host: opts.host || '',
          path: opts.path || '/',
          tls: Object.prototype.hasOwnProperty.call(opts, 'tls'),
        };
      }
    }
    return node;
  }

  function parseSsr(uri) {
    var raw = b64d(uri.slice(6));
    if (!raw) return null;
    var sep = raw.indexOf('/?');
    var main = sep === -1 ? raw : raw.slice(0, sep);
    var qs = sep === -1 ? '' : raw.slice(sep + 2);

    var parts = main.split(':');
    if (parts.length < 6) return null;
    var host = parts[0], port = parts[1], proto = parts[2];
    var method = parts[3], obfs = parts[4], pwB64 = parts[5];

    var p = pqs(qs);
    var node = {
      name: b64d((p.remarks || [''])[0]) || ('SSR-' + host + ':' + port),
      type: 'ssr',
      server: host,
      port: toInt(port),
      cipher: method,
      password: b64d(pwB64),
      protocol: proto,
      obfs: obfs,
      udp: true,
    };
    if (p.obfsparam) node['obfs-param'] = b64d(p.obfsparam[0]);
    if (p.protoparam) node['protocol-param'] = b64d(p.protoparam[0]);
    return node;
  }

  function vmessNet(node, net, host, path, tls, sni, alpn) {
    node.network = net || 'tcp';
    if (net === 'ws' || net === 'httpupgrade') {
      var o = { path: path || '/', headers: {} };
      if (host) o.headers.Host = host;
      node[net + '-opts'] = o;
    } else if (net === 'h2') {
      node['h2-opts'] = { path: path || '/', host: host ? [host] : [] };
    } else if (net === 'grpc') {
      node['grpc-opts'] = { 'grpc-service-name': path || '' };
    }
    if (tls) {
      node.tls = true;
      node['skip-cert-verify'] = false;
      if (sni || host) node.servername = sni || host;
      if (alpn) node.alpn = alpn.split(',').filter(Boolean);
    }
    return node;
  }

  function parseVmess(uri) {
    var raw = b64d(uri.slice(8));
    if (!raw) return null;
    var j;
    try { j = JSON.parse(raw); } catch (e) { return null; }
    if (!j || typeof j !== 'object') return null;

    var host = String(j.add || '');
    var tlsVal = String(j.tls == null ? '' : j.tls).toLowerCase();
    var tls = ['tls', 'true', '1', 'reality'].indexOf(tlsVal) !== -1;

    var node = {
      name: String(j.ps || ('VMess-' + host + ':' + j.port)),
      type: 'vmess',
      server: host,
      port: toInt(j.port, 443),
      uuid: String(j.id == null ? '' : j.id),
      alterId: toInt(j.aid || 0, 0),
      cipher: String(j.scy || 'auto') || 'auto',
      udp: true,
    };
    return vmessNet(node, String(j.net || 'tcp'), String(j.host || ''),
      String(j.path || ''), tls, String(j.sni || ''), String(j.alpn || ''));
  }

  function parseVless(uri) {
    var u = splitUrl(uri);
    if (!u || !u.hostname) return null;
    var p = pqs(u.query);
    var sec = (q(p, 'security') || 'none').toLowerCase();
    var net = q(p, 'type', 'headerType') || 'tcp';

    var node = {
      name: unq(u.fragment) || ('VLESS-' + u.hostname + ':' + portLabel(u.port)),
      type: 'vless',
      server: u.hostname,
      port: toInt(u.port, 443),
      uuid: unq(u.username || ''),
      udp: true,
    };
    var enc = q(p, 'encryption');
    if (enc && enc !== 'none') node.encryption = enc;
    var flow = q(p, 'flow');
    if (flow) node.flow = flow;

    net = (net === 'http' ? 'tcp' : net);
    node.network = net;

    var sni = q(p, 'sni', 'peer', 'host');
    if (sec === 'tls' || sec === 'reality') {
      node.tls = true;
      if (sni) node.servername = sni;
      var fp = q(p, 'fp');
      if (fp) node['client-fingerprint'] = fp;
      var alpn = q(p, 'alpn');
      if (alpn) node.alpn = alpn.split(',').filter(Boolean);
      if (toBool(q(p, 'allowInsecure', 'insecure'))) node['skip-cert-verify'] = true;
    }
    if (sec === 'reality') {
      node['reality-opts'] = { 'public-key': q(p, 'pbk'), 'short-id': q(p, 'sid') };
    }

    if (net === 'ws') {
      var wo = { path: unq(q(p, 'path') || '/'), headers: {} };
      var wh = q(p, 'host');
      if (wh) wo.headers.Host = wh;
      node['ws-opts'] = wo;
    } else if (net === 'grpc') {
      node['grpc-opts'] = { 'grpc-service-name': q(p, 'serviceName') };
    } else if (net === 'httpupgrade') {
      node['httpupgrade-opts'] = { path: q(p, 'path') || '/', host: q(p, 'host') };
    } else if (net === 'tcp' && q(p, 'headerType') === 'http') {
      node.network = 'http';
      var ho = { path: [q(p, 'path') || '/'], headers: {} };
      var hh = q(p, 'host');
      if (hh) ho.headers.Host = [hh];
      node['http-opts'] = ho;
    }
    return node;
  }

  function parseTrojan(uri) {
    var u = splitUrl(uri);
    if (!u || !u.hostname) return null;
    var p = pqs(u.query);

    var node = {
      name: unq(u.fragment) || ('Trojan-' + u.hostname + ':' + portLabel(u.port)),
      type: 'trojan',
      server: u.hostname,
      port: toInt(u.port, 443),
      password: unq(u.username || ''),
      udp: true,
    };
    var net = q(p, 'type') || 'tcp';
    var sni = q(p, 'sni', 'peer');
    if ((q(p, 'security') || 'tls') !== 'none') node.tls = true;
    if (sni) node.sni = sni;
    if (toBool(q(p, 'allowInsecure', 'insecure'))) node['skip-cert-verify'] = true;
    var fp = q(p, 'fp');
    if (fp) node['client-fingerprint'] = fp;

    if (net === 'ws') {
      node.network = 'ws';
      var wo = { path: q(p, 'path') || '/', headers: {} };
      var wh = q(p, 'host');
      if (wh) wo.headers.Host = wh;
      node['ws-opts'] = wo;
    } else if (net === 'grpc') {
      node.network = 'grpc';
      node['grpc-opts'] = { 'grpc-service-name': q(p, 'serviceName') };
    }
    return node;
  }

  function parseHy2(uri) {
    var u = splitUrl(uri);
    if (!u || !u.hostname) return null;
    var p = pqs(u.query);

    var node = {
      name: unq(u.fragment) || ('HY2-' + u.hostname + ':' + portLabel(u.port)),
      type: 'hysteria2',
      server: u.hostname,
      port: toInt(u.port, 443),
      password: unq(u.username || '') || q(p, 'password') || '',
    };
    var sni = q(p, 'sni', 'peer');
    if (sni) node.sni = sni;
    if (toBool(q(p, 'insecure'))) node['skip-cert-verify'] = true;
    var obfs = q(p, 'obfs');
    if (obfs) {
      node.obfs = obfs;
      node['obfs-password'] = q(p, 'obfs-password');
    }
    var alpn = q(p, 'alpn');
    if (alpn) node.alpn = alpn.split(',').filter(Boolean);
    var up = q(p, 'up');
    if (up) node.up = up;
    var down = q(p, 'down');
    if (down) node.down = down;
    return node;
  }

  function parseHy1(uri) {
    var u = splitUrl(uri);
    if (!u || !u.hostname) return null;
    var p = pqs(u.query);

    var node = {
      name: unq(u.fragment) || ('HY-' + u.hostname + ':' + portLabel(u.port)),
      type: 'hysteria',
      server: u.hostname,
      port: toInt(u.port, 443),
      protocol: q(p, 'protocol') || 'udp',
      'auth-str': q(p, 'auth') || unq(u.username || ''),
    };
    var sni = q(p, 'peer', 'sni');
    if (sni) node.sni = sni;
    var up = q(p, 'upmbps');
    if (up) node.up = up;
    var down = q(p, 'downmbps');
    if (down) node.down = down;
    var obfs = q(p, 'obfs');
    if (obfs) node.obfs = obfs;
    var alpn = q(p, 'alpn');
    if (alpn) node.alpn = alpn.split(',').filter(Boolean);
    if (toBool(q(p, 'insecure'))) node['skip-cert-verify'] = true;
    return node;
  }

  function parseTuic(uri) {
    var u = splitUrl(uri);
    if (!u || !u.hostname) return null;
    var p = pqs(u.query);

    var node = {
      name: unq(u.fragment) || ('TUIC-' + u.hostname + ':' + portLabel(u.port)),
      type: 'tuic',
      server: u.hostname,
      port: toInt(u.port, 443),
      uuid: unq(u.username || ''),
      password: unq(u.password || ''),
      'udp-relay-mode': q(p, 'udp_relay_mode') || 'native',
      'congestion-controller': q(p, 'congestion_control', 'congestion_controller') || 'bbr',
    };
    var sni = q(p, 'sni', 'peer');
    if (sni) node.sni = sni;
    var alpn = q(p, 'alpn');
    node.alpn = alpn ? alpn.split(',').filter(Boolean) : ['h3'];
    if (toBool(q(p, 'insecure', 'allow_insecure'))) node['skip-cert-verify'] = true;
    return node;
  }

  var PARSERS = {
    ss: parseSs, ssr: parseSsr, vmess: parseVmess, vless: parseVless,
    trojan: parseTrojan, 'trojan-go': parseTrojan,
    hysteria2: parseHy2, hy2: parseHy2,
    hysteria: parseHy1,
    tuic: parseTuic,
  };

  /* ---------------------------------------------------------------------- *
   * 五、订阅文本 → 节点
   * ---------------------------------------------------------------------- */

  function splitNodes(text) {
    text = String(text == null ? '' : text).trim();
    if (isBase64Blob(text)) {
      var dec = b64d(text);
      if (dec.indexOf('://') !== -1) text = dec;
    }
    var out = [];
    text.split(/[\r\n]+/).forEach(function (line) {
      line = line.trim();
      if (line.indexOf('://') !== -1) out.push(line);
    });
    return out;
  }

  function parseSubscription(text) {
    var nodes = [], failed = [], seen = {};

    splitNodes(text).forEach(function (uri) {
      var scheme = uri.split('://')[0].toLowerCase();
      var fn = PARSERS[scheme];
      if (!fn) { failed.push([scheme, '不支持的协议']); return; }

      var n = null;
      try { n = fn(uri); }
      catch (e) {
        n = null;
        failed.push([scheme, '解析异常 ' + (e && e.message ? e.message : e)]);
      }
      if (!n || !n.server) { failed.push([scheme, '字段缺失']); return; }

      n._uri = uri;                                  // 保留原始 URI，供 Base64 / 原样输出用
      var key = stableJson(n, ['name', '_uri']);
      if (seen[key]) return;                         // 完全重复的节点直接丢弃
      seen[key] = true;
      nodes.push(n);
    });

    // 重名去冲突
    var names = {}, counter = {};
    nodes.forEach(function (n) {
      var name = String(n.name == null ? '' : n.name).trim() || (n.type + '-' + n.server);
      if (names[name]) {
        counter[name] = (counter[name] || 1) + 1;
        name = name + ' #' + counter[name];
      }
      names[name] = true;
      n.name = name;
    });

    var types = {};
    nodes.forEach(function (n) { types[n.type] = (types[n.type] || 0) + 1; });
    return { nodes: nodes, stats: { total: nodes.length, failed: failed, types: types } };
  }

  /** 稳定的 JSON 字符串化（用于节点去重），可选排除某些字段。 */
  function stableJson(v, exclude) {
    exclude = exclude || [];
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(function (x) { return stableJson(x); }).join(',') + ']';
    var keys = Object.keys(v).filter(function (k) { return exclude.indexOf(k) === -1; }).sort();
    return '{' + keys.map(function (k) {
      return JSON.stringify(k) + ':' + stableJson(v[k]);
    }).join(',') + '}';
  }

  /* ---------------------------------------------------------------------- *
   * 六、生成 Clash 配置
   * ---------------------------------------------------------------------- */

  var CN_DIRECT = [
    'DOMAIN-SUFFIX,cn', 'DOMAIN-SUFFIX,com.cn', 'DOMAIN-SUFFIX,net.cn', 'DOMAIN-SUFFIX,org.cn',
    'DOMAIN-SUFFIX,gov.cn', 'DOMAIN-SUFFIX,edu.cn', 'DOMAIN-SUFFIX,qq.com', 'DOMAIN-SUFFIX,weixin.qq.com',
    'DOMAIN-SUFFIX,tencent.com', 'DOMAIN-SUFFIX,taobao.com', 'DOMAIN-SUFFIX,tmall.com',
    'DOMAIN-SUFFIX,alicdn.com', 'DOMAIN-SUFFIX,alipay.com', 'DOMAIN-SUFFIX,aliyun.com',
    'DOMAIN-SUFFIX,baidu.com', 'DOMAIN-SUFFIX,bdstatic.com', 'DOMAIN-SUFFIX,jd.com',
    'DOMAIN-SUFFIX,163.com', 'DOMAIN-SUFFIX,126.com', 'DOMAIN-SUFFIX,bilibili.com',
    'DOMAIN-SUFFIX,hdslb.com', 'DOMAIN-SUFFIX,douyin.com', 'DOMAIN-SUFFIX,zhihu.com',
    'DOMAIN-SUFFIX,cnblogs.com', 'DOMAIN-SUFFIX,csdn.net', 'DOMAIN-SUFFIX,gitee.com',
  ];
  var AD_BLOCK = [
    'DOMAIN-SUFFIX,doubleclick.net', 'DOMAIN-SUFFIX,googlesyndication.com',
    'DOMAIN-SUFFIX,googleadservices.com', 'DOMAIN-SUFFIX,adservice.google.com',
    'DOMAIN-SUFFIX,adsrvr.org', 'DOMAIN-SUFFIX,adnxs.com', 'DOMAIN-SUFFIX,criteo.com',
    'DOMAIN-SUFFIX,taboola.com', 'DOMAIN-SUFFIX,outbrain.com', 'DOMAIN-SUFFIX,umeng.com',
    'DOMAIN-SUFFIX,cnzz.com', 'DOMAIN-SUFFIX,51.la', 'DOMAIN-SUFFIX,mmstat.com',
  ];
  var MEDIA = [
    'DOMAIN-SUFFIX,youtube.com', 'DOMAIN-SUFFIX,googlevideo.com', 'DOMAIN-SUFFIX,ytimg.com',
    'DOMAIN-SUFFIX,netflix.com', 'DOMAIN-SUFFIX,nflxvideo.net', 'DOMAIN-SUFFIX,twitter.com',
    'DOMAIN-SUFFIX,x.com', 'DOMAIN-SUFFIX,twimg.com', 'DOMAIN-SUFFIX,instagram.com',
    'DOMAIN-SUFFIX,facebook.com', 'DOMAIN-SUFFIX,t.me', 'DOMAIN-SUFFIX,telegram.org',
    'DOMAIN-SUFFIX,openai.com', 'DOMAIN-SUFFIX,anthropic.com', 'DOMAIN-SUFFIX,claude.ai',
    'DOMAIN-SUFFIX,github.com', 'DOMAIN-SUFFIX,githubusercontent.com',
  ];

  function buildConfig(nodes, opts) {
    opts = opts || {};
    var fullRules = opts.fullRules !== false;
    var mixedPort = opts.mixedPort === undefined ? 7890 : opts.mixedPort;
    var ctrlPort = opts.ctrlPort === undefined ? 9090 : opts.ctrlPort;
    var tun = !!opts.tun;
    var testUrl = opts.testUrl || TEST_URL;
    var providerUrl = opts.providerUrl || '';
    var providerName = opts.providerName || 'proxy-sub';
    var providerUa = opts.providerUa || DEFAULT_UA;
    var providerFilter = opts.providerFilter || '';
    var providerExclude = opts.providerExclude || '';
    var providerInterval = opts.providerInterval === undefined ? 3600 : opts.providerInterval;

    var clean = nodes.map(function (n) {
      var o = {};
      Object.keys(n).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = n[k]; });
      return o;
    });
    var names = clean.map(function (n) { return n.name; });
    var useProvider = !!providerUrl;

    var cfg = {
      'mixed-port': mixedPort,
      'allow-lan': false,
      mode: 'rule',
      'log-level': 'info',
      ipv6: false,
      'external-controller': '127.0.0.1:' + ctrlPort,
      'unified-delay': true,
      'tcp-concurrent': true,
      'find-process-mode': 'strict',
      profile: { 'store-selected': true, 'store-fake-ip': true },
      sniffer: {
        enable: true,
        sniff: {
          HTTP: { ports: [80, '8080-8880'], 'override-destination': true },
          TLS: { ports: [443, 8443] },
          QUIC: { ports: [443, 8443] },
        },
        'skip-domain': ['Mijia Cloud', '+.push.apple.com'],
      },
      // DNS 设计要点（血泪教训）：
      //   1) 绝对不要配 fallback 指向 1.1.1.1 / 8.8.8.8 —— 国内直连不通，
      //      配合 fallback-filter 会让国外域名解析返回空，节点域名解析失败 → 全部 Timeout。
      //   2) proxy-server-nameserver 专门用于解析节点服务器域名，必须走国内可直连的 DNS。
      dns: {
        enable: true,
        ipv6: false,
        'enhanced-mode': 'fake-ip',
        'fake-ip-range': '198.18.0.1/16',
        'fake-ip-filter': ['*.lan', '*.local', '+.msftconnecttest.com', '+.msftncsi.com',
          'localhost.ptlogin2.qq.com', '+.srv.nintendo.net', '+.stun.playstation.net'],
        'default-nameserver': ['223.5.5.5', '119.29.29.29'],
        'proxy-server-nameserver': ['223.5.5.5', '119.29.29.29'],
        nameserver: ['223.5.5.5', '119.29.29.29',
          'https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'],
      },
    };

    // ---- 节点来源 ----
    // provider 模式：只写一条订阅引用，节点由内核按 interval 自动拉取更新，
    //                配置文件里不含任何节点密钥。
    // 直连模式：把解析好的节点直接内嵌进配置。
    if (useProvider) {
      var prov = {
        type: 'http',
        url: providerUrl,
        interval: providerInterval,
        path: './providers/' + providerName + '.yaml',
        // ★ 必须带 Clash 系 UA，否则机场可能返回网页 HTML 而不是节点列表
        header: { 'User-Agent': [providerUa] },
        'health-check': { enable: true, url: testUrl, interval: 300 },
      };
      if (providerFilter) prov.filter = providerFilter;
      if (providerExclude) prov['exclude-filter'] = providerExclude;
      cfg['proxy-providers'] = {};
      cfg['proxy-providers'][providerName] = prov;
    } else {
      cfg.proxies = clean;
    }

    // provider 模式下 provider 的节点不会自动进组 —— 必须在组上写 use 才会被引用
    var dyn = useProvider ? { use: [providerName] } : {};
    var selNodes = useProvider ? [] : names.slice();
    var autoNodes = useProvider ? [] : (names.length ? names.slice() : ['DIRECT']);

    var autoGroup = { name: '♻️ 自动选择', type: 'url-test', url: testUrl, interval: 300, tolerance: 50, lazy: true };
    if (autoNodes.length) autoGroup.proxies = autoNodes;
    Object.assign(autoGroup, dyn);

    cfg['proxy-groups'] = [
      Object.assign({ name: '🚀 节点选择', type: 'select', proxies: ['♻️ 自动选择', 'DIRECT'].concat(selNodes) }, dyn),
      autoGroup,
      { name: '🌍 国外媒体', type: 'select', proxies: ['🚀 节点选择', '♻️ 自动选择', 'DIRECT'] },
      { name: '🎯 全球直连', type: 'select', proxies: ['DIRECT', '🚀 节点选择'] },
      { name: '🛑 广告拦截', type: 'select', proxies: ['REJECT', 'DIRECT'] },
      { name: '🐟 漏网之鱼', type: 'select', proxies: ['🚀 节点选择', 'DIRECT', '♻️ 自动选择'] },
    ];

    if (tun) {
      cfg.tun = {
        enable: true, stack: 'mixed', 'dns-hijack': ['any:53'],
        'auto-route': true, 'auto-detect-interface': true,
      };
    }

    var rules;
    if (fullRules) {
      rules = ['GEOIP,LAN,🎯 全球直连,no-resolve', 'GEOIP,PRIVATE,🎯 全球直连,no-resolve'];
      AD_BLOCK.forEach(function (r) { rules.push(r + ',🛑 广告拦截'); });
      CN_DIRECT.forEach(function (r) { rules.push(r + ',🎯 全球直连'); });
      MEDIA.forEach(function (r) { rules.push(r + ',🌍 国外媒体'); });
      rules.push('GEOIP,CN,🎯 全球直连', 'MATCH,🐟 漏网之鱼');
    } else {
      rules = ['GEOIP,CN,🎯 全球直连', 'MATCH,🐟 漏网之鱼'];
    }
    cfg.rules = rules;
    return cfg;
  }

  /* ---------------------------------------------------------------------- *
   * 七、节点筛选 / 排序 / 去重 / 开关
   * ---------------------------------------------------------------------- */

  function matchAny(name, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i];
      if (!p) continue;
      try {
        if (new RegExp(p, 'i').test(name)) return true;
      } catch (e) {
        if (name.toLowerCase().indexOf(p.toLowerCase()) !== -1) return true;
      }
    }
    return false;
  }

  function filterNodes(nodes, include, exclude) {
    var inc = String(include || '').split(/[|,]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var exc = String(exclude || '').split(/[|,]/).map(function (s) { return s.trim(); }).filter(Boolean);
    return nodes.filter(function (n) {
      if (inc.length && !matchAny(n.name, inc)) return false;
      if (exc.length && matchAny(n.name, exc)) return false;
      return true;
    });
  }

  /** 按名称自然序排序（c22s2 排在 c22s10 前面）。 */
  function naturalKey(name) {
    return String(name).split(/(\d+)/).map(function (t) {
      return /^\d+$/.test(t) ? parseInt(t, 10) : t.toLowerCase();
    });
  }

  function cmpNatural(a, b) {
    var ka = naturalKey(a), kb = naturalKey(b);
    var n = Math.min(ka.length, kb.length);
    for (var i = 0; i < n; i++) {
      var x = ka[i], y = kb[i];
      if (x === y) continue;
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      var sx = String(x), sy = String(y);
      if (sx === sy) continue;
      return sx < sy ? -1 : 1;
    }
    return ka.length - kb.length;
  }

  function sortNodes(nodes) {
    return nodes.slice().sort(function (a, b) { return cmpNatural(a.name, b.name); });
  }

  function dedupeNodes(nodes) {
    var seen = {}, out = [];
    nodes.forEach(function (n) {
      var k = [n.type, n.server, n.port, String(n.uuid || n.password || '')].join('\u0000');
      if (seen[k]) return;
      seen[k] = true;
      out.push(n);
    });
    return out;
  }

  /** 就地套用 UDP / TFO / 跳过证书验证 开关。 */
  function applySwitches(nodes, opts) {
    opts = opts || {};
    var udp = opts.udp !== false;
    var tfo = !!opts.tfo;
    var scv = !!opts.scv;
    nodes.forEach(function (n) {
      if (['ss', 'ssr', 'vmess', 'vless', 'trojan'].indexOf(n.type) !== -1) {
        if (udp) n.udp = true;
        else delete n.udp;
      }
      if (tfo) n.tfo = true;
      else delete n.tfo;
      if (scv) n['skip-cert-verify'] = true;
    });
  }

  /* ---------------------------------------------------------------------- *
   * 八、其它客户端格式输出
   * ---------------------------------------------------------------------- */

  function toBase64Sub(nodes) {
    var text = nodes.filter(function (n) { return n._uri; })
      .map(function (n) { return n._uri; }).join('\n');
    var bytes = new TextEncoder().encode(text);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function toNodeList(nodes) {
    return nodes.filter(function (n) { return n._uri; })
      .map(function (n) { return n._uri; }).join('\n');
  }

  function surgeSafe(name) {
    var s = String(name);
    [',', '=', '#', ';', '"', "'", '`'].forEach(function (ch) {
      s = s.split(ch).join(ch === ',' ? ' ' : '');
    });
    s = s.split(/\s+/).filter(Boolean).join(' ');
    return s || 'Proxy';
  }

  function toSurge(nodes, testUrl) {
    testUrl = testUrl || TEST_URL;
    var prox = [];
    nodes.forEach(function (n) {
      var nm = surgeSafe(n.name), t = n.type;
      var host = n.server, port = n.port;
      var s = null;
      try {
        if (t === 'ss') {
          s = nm + ' = ss, ' + host + ', ' + port + ', encrypt-method=' + n.cipher + ', password=' + n.password;
          if (n.plugin === 'obfs') {
            var o = n['plugin-opts'] || {};
            s += ', obfs=' + (o.mode || 'http');
            if (o.host) s += ', obfs-host=' + o.host;
          }
          if (n.udp) s += ', udp-relay=true';
        } else if (t === 'vmess') {
          s = nm + ' = vmess, ' + host + ', ' + port + ', username=' + n.uuid;
          if (n.tls) s += ', tls=true';
          if (n.servername) s += ', sni=' + n.servername;
          if (n['skip-cert-verify']) s += ', skip-cert-verify=true';
          s += ', vmess-aead=true';
          if (n.network === 'ws') {
            s += ', ws=true, ws-path=' + ((n['ws-opts'] || {}).path || '/');
            var h = ((n['ws-opts'] || {}).headers || {}).Host;
            if (h) s += ', ws-headers=Host:' + h;
          }
        } else if (t === 'trojan') {
          s = nm + ' = trojan, ' + host + ', ' + port + ', password=' + n.password;
          if (n.sni) s += ', sni=' + n.sni;
          if (n['skip-cert-verify']) s += ', skip-cert-verify=true';
          if (n.network === 'ws') {
            s += ', ws=true, ws-path=' + ((n['ws-opts'] || {}).path || '/');
            var h2 = ((n['ws-opts'] || {}).headers || {}).Host;
            if (h2) s += ', ws-headers=Host:' + h2;
          }
        } else if (t === 'hysteria2') {
          s = nm + ' = hysteria2, ' + host + ', ' + port + ', password=' + n.password;
          if (n.sni) s += ', sni=' + n.sni;
          if (n['skip-cert-verify']) s += ', skip-cert-verify=true';
          if (n.down) s += ', download-bandwidth=' + n.down;
        } else if (t === 'vless') {
          s = nm + ' = vless, ' + host + ', ' + port + ', username=' + n.uuid;
          if (n.tls) s += ', tls=true';
          if (n.servername) s += ', sni=' + n.servername;
          if (n['skip-cert-verify']) s += ', skip-cert-verify=true';
          if (n.flow) s += ', flow=' + n.flow;
          var ro = n['reality-opts'] || {};
          if (ro['public-key']) s += ', reality-public-key=' + ro['public-key'];
          if (ro['short-id']) s += ', reality-short-id=' + ro['short-id'];
        }
      } catch (e) { s = null; }
      if (s) prox.push(s);
    });

    var joined = nodes.map(function (n) { return surgeSafe(n.name); }).join(', ');
    return [
      '#!MANAGED-CONFIG sub2clash 生成（基础版 Surge 配置）',
      '',
      '[General]',
      'loglevel = notify',
      'dns-server = 223.5.5.5, 119.29.29.29',
      '',
      '[Proxy]',
    ].concat(prox).concat([
      '',
      '[Proxy Group]',
      '节点选择 = select, ' + joined + ', DIRECT',
      '自动选择 = url-test, ' + joined + ', url=' + testUrl + ', interval=300, tolerance=50',
      '',
      '[Rule]',
      'GEOIP,CN,DIRECT',
      'FINAL,节点选择',
      '',
    ]).join('\n');
  }

  var TARGETS = {
    clash: 'clash', 'clash-meta': 'clash', mihomo: 'clash', clashmeta: 'clash',
    provider: 'provider', 'clash-provider': 'provider', 'sub-provider': 'provider',
    base64: 'base64', v2ray: 'base64', v2rayn: 'base64', ss: 'base64',
    'node-list': 'node-list', nodelist: 'node-list', raw: 'node-list',
    surge: 'surge', surge4: 'surge', surge5: 'surge',
  };

  function buildSubscription(nodes, target, opts) {
    opts = opts || {};
    var kind = TARGETS[String(target || 'clash').toLowerCase()] || 'clash';

    if (kind === 'clash' || kind === 'provider') {
      var isProv = kind === 'provider';
      var cfg = buildConfig(nodes, {
        fullRules: opts.fullRules !== false,
        mixedPort: opts.mixedPort === undefined ? 7890 : opts.mixedPort,
        ctrlPort: opts.ctrlPort === undefined ? 9090 : opts.ctrlPort,
        tun: !!opts.tun,
        testUrl: opts.testUrl || TEST_URL,
        providerUrl: isProv ? (opts.providerUrl || '') : '',
        providerName: opts.providerName || 'proxy-sub',
        providerUa: opts.providerUa || DEFAULT_UA,
        providerFilter: opts.providerFilter || '',
        providerExclude: opts.providerExclude || '',
        providerInterval: opts.providerInterval === undefined ? 3600 : opts.providerInterval,
      });
      var head;
      if (isProv) {
        head = '# sub2clash · provider 模式：节点由订阅自动更新（本地预解析到 '
          + nodes.length + ' 个，实际以下载结果为准）\n';
        return { text: head + dumpYaml(cfg), mime: 'text/yaml; charset=utf-8', filename: 'clash-provider.yaml' };
      }
      head = '# sub2clash · ' + nodes.length + ' 个节点\n';
      return { text: head + dumpYaml(cfg), mime: 'text/yaml; charset=utf-8', filename: 'config.yaml' };
    }
    if (kind === 'base64') {
      return { text: toBase64Sub(nodes), mime: 'text/plain; charset=utf-8', filename: 'sub.txt' };
    }
    if (kind === 'node-list') {
      return { text: toNodeList(nodes), mime: 'text/plain; charset=utf-8', filename: 'nodes.txt' };
    }
    if (kind === 'surge') {
      return { text: toSurge(nodes, opts.testUrl), mime: 'text/plain; charset=utf-8', filename: 'surge.conf' };
    }
    throw new Error('不支持的客户端类型：' + target);
  }

  /** 一步到位：订阅文本 → 目标格式（网页 UI 直接用这个）。 */
  function convert(text, options) {
    options = options || {};
    var parsed = parseSubscription(text);
    var nodes = parsed.nodes;
    nodes = filterNodes(nodes, options.include, options.exclude);
    if (options.dedupe !== false) nodes = dedupeNodes(nodes);
    if (options.sort) nodes = sortNodes(nodes);
    if (options.udp === false || options.tfo || options.scv) {
      applySwitches(nodes, { udp: options.udp !== false, tfo: !!options.tfo, scv: !!options.scv });
    }
    if (!nodes.length) {
      throw new Error('没有解析到有效节点（或筛选后为空）。请检查订阅内容是否完整、'
        + 'include / exclude 是否写得太严。');
    }
    var built = buildSubscription(nodes, options.target || 'clash', {
      fullRules: options.fullRules !== false,
      mixedPort: options.mixedPort === undefined ? 7890 : options.mixedPort,
      tun: !!options.tun,
      providerUrl: options.providerUrl || '',
      providerName: options.providerName || 'proxy-sub',
      providerUa: options.providerUa || DEFAULT_UA,
      providerFilter: options.include || '',
      providerExclude: options.exclude || '',
      providerInterval: options.providerInterval === undefined ? 3600 : options.providerInterval,
    });
    built.nodes = nodes;
    built.stats = {
      total: nodes.length,
      failed: parsed.stats.failed,
      types: parsed.stats.types,
    };
    return built;
  }

  var api = {
    DEFAULT_UA: DEFAULT_UA,
    TEST_URL: TEST_URL,
    b64d: b64d,
    unq: unq,
    pqs: pqs,
    toBool: toBool,
    isBase64Blob: isBase64Blob,
    splitUrl: splitUrl,
    dumpYaml: dumpYaml,
    scalar: scalar,
    parseSubscription: parseSubscription,
    splitNodes: splitNodes,
    buildConfig: buildConfig,
    buildSubscription: buildSubscription,
    filterNodes: filterNodes,
    sortNodes: sortNodes,
    dedupeNodes: dedupeNodes,
    applySwitches: applySwitches,
    toBase64Sub: toBase64Sub,
    toNodeList: toNodeList,
    toSurge: toSurge,
    surgeSafe: surgeSafe,
    convert: convert,
  };

  return api;
})();

if (typeof globalThis !== 'undefined') globalThis.Sub2Clash = Sub2Clash;
if (typeof module !== 'undefined' && module.exports) module.exports = Sub2Clash;
