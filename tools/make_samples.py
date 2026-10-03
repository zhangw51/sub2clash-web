# -*- coding: utf-8 -*-
"""生成多协议 + 边界情况测试样本，用于 JS / Python 引擎对照。"""
import base64
import json
from pathlib import Path


def b64(s: str) -> str:
    return base64.b64encode(s.encode()).decode()


lines = []

# --- vmess ---
lines.append("vmess://" + b64(json.dumps({
    "v": "2", "ps": "测试 VMess WS", "add": "test.example.com", "port": "443",
    "id": "11111111-2222-3333-4444-555555555555", "aid": "0", "scy": "auto",
    "net": "ws", "type": "none", "host": "test.example.com", "path": "/ws",
    "tls": "tls", "sni": "test.example.com", "alpn": "h2,http/1.1", "fp": "chrome",
}, ensure_ascii=False)))

lines.append("vmess://" + b64(json.dumps({
    "v": "2", "ps": "VMess gRPC", "add": "grpc.example.com", "port": 8443,
    "id": "22222222-3333-4444-5555-666666666666", "aid": 0,
    "scy": "chacha20-poly1305", "net": "grpc", "path": "grpcsvc", "tls": "",
}, ensure_ascii=False)))

lines.append("vmess://" + b64(json.dumps({
    "v": "2", "ps": "VMess h2 无TLS", "add": "h2.example.com", "port": "80",
    "id": "99999999-8888-7777-6666-555555555555", "aid": "64", "scy": "",
    "net": "h2", "host": "h2.example.com", "path": "/h2path", "tls": "false",
}, ensure_ascii=False)))

# --- ssr ---
lines.append("ssr://" + b64(
    "test.example.com:8443:auth_aes128_md5:aes-256-cfb:tls1.2_ticket_auth:" + b64("mypassword")
    + "/?obfsparam=" + b64("obfs.example.com")
    + "&protoparam=" + b64("1234:abcd")
    + "&remarks=" + b64("测试 SSR")
    + "&group=" + b64("默认")))

# --- trojan ---
lines.append("trojan://mypass@test.example.com:443?sni=test.example.com&type=ws"
             "&path=%2Ftrojan&host=test.example.com&allowInsecure=1&fp=chrome#Trojan%20WS")
lines.append("trojan://pw2@tj.example.com:8443?sni=tj.example.com&type=grpc"
             "&serviceName=tjsvc&security=tls#Trojan%20gRPC")
lines.append("trojan://pw3@plain.example.com:443?security=none#Trojan%20NoTLS")

# --- hysteria2 ---
lines.append("hysteria2://letmein@test.example.com:443?sni=test.example.com&insecure=1"
             "&obfs=salamander&obfs-password=obfspw&alpn=h3&up=100&down=200#HY2%20Obfs")
lines.append("hysteria2://pw@hy2b.example.com:8443?peer=hy2b.example.com#HY2%20Bare")

# --- hysteria v1 ---
lines.append("hysteria://test.example.com:443?protocol=udp&auth=authpw&peer=test.example.com"
             "&insecure=1&upmbps=100&downmbps=200&alpn=h3&obfs=xplus#HY1")

# --- tuic ---
lines.append("tuic://22222222-3333-4444-5555-666666666666:tpass@test.example.com:443"
             "?sni=test.example.com&alpn=h3&congestion_control=bbr&udp_relay_mode=native#TUIC")
lines.append("tuic://33333333-4444-5555-6666-777777777777:t2@tuic2.example.com:8443"
             "?congestion_controller=cubic&allow_insecure=1#TUIC%20NoALPN")

# --- vless ---
lines.append("vless://33333333-4444-5555-6666-777777777777@test.example.com:443"
             "?encryption=none&security=tls&type=ws&host=test.example.com&path=%2Fvless"
             "&sni=test.example.com&fp=firefox#VLESS%20WS")
lines.append("vless://44444444-5555-6666-7777-888888888888@test.example.com:443"
             "?encryption=none&security=reality&type=grpc&serviceName=grpcsvc"
             "&sni=www.apple.com&fp=chrome&pbk=AAAABBBBCCCC&sid=01234567#Reality%20gRPC")
lines.append("vless://55555555-6666-7777-8888-999999999999@test.example.com:80"
             "?encryption=none&security=none&type=tcp&headerType=http"
             "&host=http.example.com&path=%2Fh#VLESS%20HTTP")
lines.append("vless://66666666-7777-8888-9999-000000000000@up.example.com:443"
             "?encryption=none&security=tls&type=httpupgrade&path=%2Fup"
             "&host=up.example.com&sni=up.example.com#Vless%20HTTPUpgrade")
lines.append("vless://77777777-8888-9999-0000-111111111111@r.example.com:443"
             "?encryption=none&security=reality&type=tcp&sni=www.microsoft.com"
             "&fp=safari&pbk=ZZZZ&sid=ab&flow=xtls-rprx-vision#Reality%20Vision")

# --- shadowsocks ---
lines.append("ss://" + b64("chacha20-ietf-poly1305:pw123456") + "@test.example.com:8080#SS%20Base64")
lines.append("ss://" + b64("aes-256-gcm:fullpw@test.example.com:8388") + "#SS%20Full")
lines.append("ss://" + b64("aes-128-gcm:sspw")
             + "@test.example.com:9000?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dbing.com#SS%20obfs")
lines.append("ss://" + b64("aes-128-gcm:v2pw")
             + "@test.example.com:9001?plugin=v2ray-plugin%3Bmode%3Dwebsocket%3Bhost%3Dcdn.example.com"
               "%3Bpath%3D%2Fv2%3Btls#SS%20v2ray-plugin")

# --- 边界：YAML 引号 / 重名 / 去重 ---
lines.append("vless://88888888-9999-0000-1111-222222222222@edge.example.com:443"
             "?encryption=none&security=tls&sni=edge.example.com#%2A.lan%20%E6%B5%8B%E8%AF%95")
lines.append("trojan://p@star.example.com:443#a%3A%20b%20%23c")
lines.append("trojan://p2@num.example.com:443#0x1f")
lines.append("trojan://p3@dup.example.com:443#重名节点")
lines.append("trojan://p4@dup2.example.com:443#重名节点")
lines.append(lines[13])                                   # 与上面完全重复 → 应被去重
lines.append("vless://33333333-4444-5555-6666-777777777777@test.example.com:443"
             "?encryption=none&security=tls&type=ws&host=test.example.com&path=%2Fvless"
             "&sni=test.example.com&fp=firefox#%E5%90%8C%E5%8F%82%E6%95%B0%E5%BC%82%E5%90%8D")

out = Path(__file__).resolve().parents[1] / "testdata" / "samples.txt"
out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="")
print(f"样本已写入 {out}  共 {len(lines)} 行")
