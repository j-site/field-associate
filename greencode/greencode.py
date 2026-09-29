#!/usr/bin/env python3
"""
greencode — プログラムの消費エネルギーとCO2を計測し、改善前後を比較するツール

    greencode run [オプション] -- <コマンド>
    greencode compare [オプション] --before "<コマンド>" --after "<コマンド>"

  --repeat N      N回実行して中央値を採用（既定 3）
  --units N       機能単位の数（例: 処理した件数）。SCI（件あたりCO2）を出す
  --watts W       推定モードで使うCPU1コアあたりの消費電力（既定 8W）
  --grid G        電力のCO2排出係数 kg-CO2/kWh（既定 0.421 = 東京電力EP 2024年度）
  --json          JSONで出力

エネルギーの求め方（出力に必ずどちらかを明記する）:
  実測 … Linuxの電力センサー（Intel/AMD RAPL, /sys/class/powercap）が読める場合
  推定 … 読めない場合（仮想マシン・コンテナ・macOS）。CPU時間 × 1コアあたり電力
         同じマシン上での「改善前後の比」は推定でも概ね成り立つが、
         絶対値（何Wh使ったか）は目安にとどまる。

依存パッケージなし（Python 3.8+ 標準ライブラリのみ）。
"""
import argparse
import json
import os
import resource
import shlex
import statistics
import subprocess
import sys
import time

DEFAULT_WATTS_PER_CORE = 8.0     # サーバー向けCPUのTDP÷コア数のおおよその値
DEFAULT_GRID_KG_PER_KWH = 0.421  # 東京電力エナジーパートナー 2024年度 基礎排出係数（速報）
RAPL_ROOT = "/sys/class/powercap"


# ---------------------------------------------------------------- 電力センサー

def rapl_domains():
    """読めるRAPLのパッケージ領域を列挙する。権限や環境で読めなければ空"""
    domains = []
    if not os.path.isdir(RAPL_ROOT):
        return domains
    for name in sorted(os.listdir(RAPL_ROOT)):
        # intel-rapl:0 のようなトップレベル（CPUパッケージ単位）だけを使う。
        # サブ領域(intel-rapl:0:0)まで足すと二重計上になる
        if name.count(":") != 1:
            continue
        base = os.path.join(RAPL_ROOT, name)
        energy = os.path.join(base, "energy_uj")
        max_range = os.path.join(base, "max_energy_range_uj")
        try:
            with open(energy) as f:
                int(f.read())
            with open(max_range) as f:
                rng = int(f.read())
            domains.append((energy, rng))
        except (OSError, ValueError):
            continue
    return domains


def read_rapl(domains):
    values = []
    for path, _ in domains:
        with open(path) as f:
            values.append(int(f.read()))
    return values


def rapl_delta_joules(domains, before, after):
    total_uj = 0
    for (_, rng), b, a in zip(domains, before, after):
        d = a - b
        if d < 0:          # カウンタが一周した
            d += rng
        total_uj += d
    return total_uj / 1e6


# ---------------------------------------------------------------- 計測

def measure_once(cmd, domains):
    usage_before = resource.getrusage(resource.RUSAGE_CHILDREN)
    rapl_before = read_rapl(domains) if domains else None
    t0 = time.perf_counter()

    proc = subprocess.run(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    wall = time.perf_counter() - t0
    rapl_after = read_rapl(domains) if domains else None
    usage_after = resource.getrusage(resource.RUSAGE_CHILDREN)

    if proc.returncode != 0:
        raise RuntimeError(
            f"コマンドが失敗しました (exit {proc.returncode}): {cmd}\n"
            + proc.stderr.decode(errors="replace")[-800:]
        )

    cpu = (usage_after.ru_utime - usage_before.ru_utime) + (usage_after.ru_stime - usage_before.ru_stime)
    # ru_maxrss は「これまでの子プロセスの最大値」なので差分は取れない。
    # 比較用途では各コマンドを別プロセスで測るため、この値で十分。
    peak_kb = usage_after.ru_maxrss
    joules = rapl_delta_joules(domains, rapl_before, rapl_after) if domains else None
    return {"wall_s": wall, "cpu_s": cpu, "peak_rss_mb": peak_kb / 1024, "rapl_j": joules}


def measure(cmd, repeat=3, watts=DEFAULT_WATTS_PER_CORE, grid=DEFAULT_GRID_KG_PER_KWH, units=None):
    domains = rapl_domains()
    runs = [measure_once(cmd, domains) for _ in range(repeat)]

    # 外れ値（初回のキャッシュ未温など）に引っ張られないよう中央値を使う
    cpu = statistics.median(r["cpu_s"] for r in runs)
    wall = statistics.median(r["wall_s"] for r in runs)
    peak = max(r["peak_rss_mb"] for r in runs)

    if domains:
        joules = statistics.median(r["rapl_j"] for r in runs)
        method = "実測（RAPL・CPUパッケージ全体）"
    else:
        joules = cpu * watts
        method = f"推定（CPU時間 × {watts:g}W/コア）"

    kwh = joules / 3.6e6
    co2_g = kwh * grid * 1000
    result = {
        "command": cmd,
        "repeat": repeat,
        "method": method,
        "wall_s": wall,
        "cpu_s": cpu,
        "peak_rss_mb": peak,
        "energy_j": joules,
        "energy_wh": joules / 3600,
        "co2_g": co2_g,
        "grid_kg_per_kwh": grid,
    }
    if units:
        # SCI (ISO/IEC 21031:2024) の考え方：機能単位あたりの排出量。
        # ここでは運用時の排出(O)のみで、ハードウェア製造時の排出(M)は含めない
        result["units"] = units
        result["sci_mg_per_unit"] = co2_g * 1000 / units
        result["energy_mj_per_unit"] = joules * 1000 / units
    return result


# ---------------------------------------------------------------- 表示

def fmt_energy(j):
    if j < 1:
        return f"{j * 1000:.1f} mJ"
    if j < 3600:
        return f"{j:.2f} J"
    return f"{j / 3600:.3f} Wh"


def print_result(r, title=None):
    if title:
        print(f"■ {title}")
    print(f"  コマンド   {r['command']}")
    print(f"  経過時間   {r['wall_s']:.3f} 秒   CPU時間 {r['cpu_s']:.3f} 秒   最大メモリ {r['peak_rss_mb']:.0f} MB")
    print(f"  エネルギー {fmt_energy(r['energy_j'])}   CO2 {r['co2_g'] * 1000:.2f} mg")
    if "sci_mg_per_unit" in r:
        print(f"  1件あたり  {r['energy_mj_per_unit']:.4f} mJ / CO2 {r['sci_mg_per_unit']:.5f} mg")
    print(f"  算出方法   {r['method']}（中央値 / {r['repeat']}回）")


def ratio_text(before, after):
    if after <= 0:
        return "—"
    return f"{before / after:.1f}倍"


def print_compare(b, a):
    print_result(b, "改善前")
    print()
    print_result(a, "改善後")
    print()
    saved = 1 - a["energy_j"] / b["energy_j"] if b["energy_j"] > 0 else 0
    print("■ 比較")
    print(f"  エネルギー  {ratio_text(b['energy_j'], a['energy_j'])} 効率化（{saved * 100:.1f}% 削減）")
    print(f"  経過時間    {ratio_text(b['wall_s'], a['wall_s'])} 高速化")
    print(f"  メモリ      {b['peak_rss_mb']:.0f} MB → {a['peak_rss_mb']:.0f} MB")


def build_parser():
    p = argparse.ArgumentParser(prog="greencode", description="プログラムの消費エネルギーとCO2を計測する")
    sub = p.add_subparsers(dest="command", required=True)

    def common(sp):
        sp.add_argument("--repeat", type=int, default=3)
        sp.add_argument("--units", type=float, default=None)
        sp.add_argument("--watts", type=float, default=DEFAULT_WATTS_PER_CORE)
        sp.add_argument("--grid", type=float, default=DEFAULT_GRID_KG_PER_KWH)
        sp.add_argument("--json", action="store_true")

    run = sub.add_parser("run", help="コマンドを計測する")
    common(run)
    run.add_argument("cmd", nargs=argparse.REMAINDER)

    cmp_ = sub.add_parser("compare", help="改善前後を比較する")
    common(cmp_)
    cmp_.add_argument("--before", required=True)
    cmp_.add_argument("--after", required=True)
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    kw = dict(repeat=args.repeat, watts=args.watts, grid=args.grid, units=args.units)

    if args.command == "run":
        cmd = args.cmd[1:] if args.cmd and args.cmd[0] == "--" else args.cmd
        if not cmd:
            print("計測するコマンドを -- の後に指定してください", file=sys.stderr)
            return 2
        r = measure(" ".join(shlex.quote(c) for c in cmd), **kw)
        print(json.dumps(r, ensure_ascii=False, indent=2) if args.json else "")
        if not args.json:
            print_result(r)
        return 0

    b = measure(args.before, **kw)
    a = measure(args.after, **kw)
    if args.json:
        print(json.dumps({"before": b, "after": a}, ensure_ascii=False, indent=2))
    else:
        print_compare(b, a)
    return 0


if __name__ == "__main__":
    sys.exit(main())
