# -*- coding: utf-8 -*-
"""用 Python 版引擎生成各输出格式的基准文件，供与 JS 版逐字节对照。

注意：不要走 sub2clash.py 的 CLI —— 同级目录里有 deploy.json（public: true），
会让 load_source() 进入公网模式、把文件路径当成订阅文本。这里直接调函数。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sub2clash"))
import sub2clash as S          # noqa: E402

HERE = Path(__file__).resolve().parents[1]
TD = HERE / "testdata"

PROVIDER_URL = "https://jmssub.net/members/getsub.php?service=1454501&id=test"


def base_nodes(text: str):
    nodes, _ = S.parse_subscription(text)
    nodes = S.filter_nodes(nodes, "", "")
    nodes = S.dedupe_nodes(nodes)
    nodes = S.sort_nodes(nodes)
    S.apply_switches(nodes, udp=True, tfo=False, scv=False)
    return nodes


def dump(name: str, text: str):
    (TD / name).write_text(text, encoding="utf-8", newline="")
    print(f"  PY  → {name}  {len(text)} 字符")


def main():
    text = (TD / sys.argv[1]).read_text(encoding="utf-8", errors="replace")
    nodes = base_nodes(text)
    print(f"  PY  → 节点 {len(nodes)}  "
          f"{ {t: sum(1 for n in nodes if n['type'] == t) for t in {n['type'] for n in nodes} } }")

    prefix = sys.argv[2]
    for target in ("clash", "provider", "base64", "node-list", "surge"):
        body, _, _ = S.build_subscription(
            nodes, target, full_rules=True, mixed_port=7890, tun=False,
            provider_url=PROVIDER_URL, provider_name="proxy-sub",
            provider_ua=S.DEFAULT_UA, provider_interval=3600)
        dump(f"{prefix}_{target.replace('-', '')}.txt", body)


if __name__ == "__main__":
    main()
