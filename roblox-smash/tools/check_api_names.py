#!/usr/bin/env python3
"""
Roblox の機能の名前（列挙・メソッド・プロパティ）が、本物の定義に存在するかを調べる（打ち間違い・存在しない名前の検出）。
定義ファイルは luau-lsp 公式の globalTypes.None.d.luau（https://github.com/JohnnyMorganz/luau-lsp の scripts/ にある）。
使い方: python3 tools/check_api_names.py 定義ファイル スクリプト...
"""
import re, sys

defs = open(sys.argv[1], encoding="utf-8").read()
src = "\n".join(open(f, encoding="utf-8").read() for f in sys.argv[2:])
src = re.sub(r"--\[\[.*?\]\]", "", src, flags=re.S)
src = re.sub(r"--[^\n]*", "", src)
src = re.sub(r'"(?:\\.|[^"\\])*"', '""', src)

# 列挙：「declare extern type EnumX_INTERNAL extends Enum with ... end」に項目が並ぶ
blocks = {}
for m in re.finditer(r"declare extern type Enum([A-Za-z0-9]+)_INTERNAL extends Enum with\n(.*?)\nend", defs, flags=re.S):
    blocks[m.group(1)] = m.group(2)
bad_enum = []
used_enum = sorted(set(re.findall(r"Enum\.([A-Za-z0-9]+)\.([A-Za-z0-9]+)", src)))
for a, b in used_enum:
    blk = blocks.get(a)
    if blk is None or not re.search(r"^\s*" + re.escape(b) + r":", blk, flags=re.M):
        bad_enum.append(f"Enum.{a}.{b}")
print(f"列挙 {len(used_enum)} 件 / 存在しない: {bad_enum or 'なし'}")

# メソッド（:Name( の形）。自作の関数や Lua 標準のものは除く
own = set(re.findall(r"function\s+(?:[A-Za-z0-9_]+[.:])?([A-Za-z0-9_]+)\(", src))
skip = {"format", "Connect", "Wait", "Disconnect", "Lerp"}   # 文字列・合図・値型のメソッド（別の定義にある）
methods = sorted(set(re.findall(r":([A-Za-z][A-Za-z0-9]*)\(", src)) - own - skip)
bad_methods = [m for m in methods if not re.search(r"function " + re.escape(m) + r"\(", defs)]
print(f"メソッド {len(methods)} 件 / 存在しない: {bad_methods or 'なし'}")

# 代入するプロパティ
props = sorted(set(re.findall(r"\b[A-Za-z_][A-Za-z0-9_]*\.([A-Z][A-Za-z0-9]+)\s*(?:=|\+=|-=)[^=]", src)))
bad_props = [p for p in props if not re.search(r"\b" + re.escape(p) + r"\s*:", defs)]
print(f"代入するプロパティ {len(props)} 件 / 存在しない: {bad_props or 'なし'}")

# イベント（.Name:Connect( の形）
events = sorted(set(re.findall(r"\.([A-Z][A-Za-z0-9]+):Connect\(", src)) | set(re.findall(r"\.([A-Z][A-Za-z0-9]+):Wait\(", src)))
bad_events = [e for e in events if not re.search(r"\b" + re.escape(e) + r"\s*:\s*(?:RBXScriptSignal|Signal)", defs)]
print(f"イベント {len(events)} 件 / 存在しない: {bad_events or 'なし'}")

# 読み取るプロパティ（.Name の形。自作のテーブルや値型の要素は除く）
reads = set(re.findall(r"\b(?:humanoid|root|character|camera|part|model|player|inst|mark|h|b|l|r)\.([A-Z][A-Za-z0-9]+)\b", src))
reads -= {"Position", "X", "Y", "Z", "Parent", "Name"}   # 値型・基本のもの
bad_reads = sorted(p for p in reads if not re.search(r"\b" + re.escape(p) + r"\s*:", defs) and not re.search(r"function " + re.escape(p) + r"\(", defs))
print(f"読み取るプロパティ {len(reads)} 件 / 存在しない: {bad_reads or 'なし'}")
