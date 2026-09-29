#!/usr/bin/env python3
"""全実験を greencode で計測し、results.json と results.md を出力する"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from greencode import measure  # noqa: E402

PY = sys.executable
EXPERIMENTS = [
    ("1. アルゴリズムを変える", "重複検出 6,000件（全ペア比較 → 集合）",
     f"{PY} algo.py before", f"{PY} algo.py after"),
    ("2. やらない（キャッシュ）", "偏りのある3,000リクエスト（毎回計算 → 結果を記憶）",
     f"{PY} cache.py before", f"{PY} cache.py after"),
    ("3a. データを小さくする", "5,000万個の値（64bit → 8bit）",
     "./dtype f64", "./dtype i8"),
    ("3b. 並び順に読む", "8,192×8,192配列（列の順 → 行の順）",
     "./locality col", "./locality row"),
    ("4. 身の丈に合った道具", "120件の処理（1件ごとに実行環境を起動 → 1回起動）",
     f"{PY} spawn.py before", f"{PY} spawn.py after"),
    ("5. まとめて処理する", "3,000行のDB書き込み（1件ずつ確定 → 一括）",
     f"{PY} batch.py before", f"{PY} batch.py after"),
]


def build():
    import subprocess
    for name in ("dtype", "locality"):
        if not os.path.exists(name) or os.path.getmtime(name) < os.path.getmtime(f"{name}.c"):
            subprocess.run(["gcc", "-O2", "-o", name, f"{name}.c"], check=True)


def main():
    os.chdir(HERE)
    build()
    repeat = int(os.environ.get("REPEAT", "5"))
    results = []
    for name, desc, before, after in EXPERIMENTS:
        b = measure(before, repeat=repeat)
        a = measure(after, repeat=repeat)
        results.append({"name": name, "desc": desc, "before": b, "after": a})
        print(f"{name:<20} energy {b['energy_j']:.3f}J → {a['energy_j']:.3f}J "
              f"({b['energy_j'] / max(a['energy_j'], 1e-9):.1f}x)  "
              f"wall {b['wall_s']:.3f}s → {a['wall_s']:.3f}s", flush=True)

    with open("results.json", "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    lines = [
        "| 手法 | 内容 | エネルギー（前→後） | 削減率 | 効率 | 経過時間（前→後） |",
        "|---|---|---|---|---|---|",
    ]
    for r in results:
        b, a = r["before"], r["after"]
        eb, ea = b["energy_j"], a["energy_j"]
        lines.append(
            f"| {r['name']} | {r['desc']} | {eb:.2f} J → {ea:.3f} J | "
            f"{(1 - ea / eb) * 100:.1f}% | {eb / max(ea, 1e-9):.1f}倍 | "
            f"{b['wall_s']:.2f} s → {a['wall_s']:.3f} s |"
        )
    lines.append("")
    lines.append(f"算出方法: {results[0]['before']['method']}、各{repeat}回の中央値")
    with open("results.md", "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n" + "\n".join(lines))


if __name__ == "__main__":
    main()
