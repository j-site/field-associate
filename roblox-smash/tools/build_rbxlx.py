#!/usr/bin/env python3
"""
スカイ乱闘のスクリプト4つを、正しい場所に入れた Roblox Studio 用の場ファイル（dist/SkyRanto.rbxlx）を作る。
Studio で「ファイル → 開く」でそのまま開ける。使い方: python3 tools/build_rbxlx.py
"""
import os
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda p: open(os.path.join(ROOT, p), encoding="utf-8").read()

_ref = [0]


def referent():
    _ref[0] += 1
    return f"RBX{_ref[0]}"


def cdata(text):
    # CDATA の中に「]]>」は書けないので、分けて書く
    return "<![CDATA[" + text.replace("]]>", "]]]]><![CDATA[>") + "]]>"


def item(cls, name, source=None, children=(), extra=""):
    props = f'<string name="Name">{name}</string>' + extra
    if source is not None:
        props += f'<ProtectedString name="Source">{cdata(source)}</ProtectedString>'
    inner = "".join(children)
    return f'<Item class="{cls}" referent="{referent()}"><Properties>{props}</Properties>{inner}</Item>'


tree = [
    item("Workspace", "Workspace"),
    item("ReplicatedStorage", "ReplicatedStorage", children=[
        item("ModuleScript", "SmashShared", read("src/shared/SmashShared.luau")),
    ]),
    item("ServerScriptService", "ServerScriptService", children=[
        item("Script", "SmashServer", read("src/server/SmashServer.server.luau")),
        item("ModuleScript", "BotBrain", read("src/server/BotBrain.luau")),
    ]),
    item("StarterPlayer", "StarterPlayer", extra='<bool name="EnableMouseLockOption">false</bool>', children=[
        item("StarterPlayerScripts", "StarterPlayerScripts", children=[
            item("LocalScript", "SmashClient", read("src/client/SmashClient.client.luau")),
        ]),
        item("StarterCharacterScripts", "StarterCharacterScripts"),
    ]),
]

xml = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" '
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
    'xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n'
    '<Meta name="ExplicitAutoJoints">true</Meta>\n' + "\n".join(tree) + "\n</roblox>\n"
)

ET.fromstring(xml.encode("utf-8"))   # 正しい XML かを確かめる（壊れていたらここで止まる）

out = os.path.join(ROOT, "dist", "SkyRanto.rbxlx")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f:
    f.write(xml)
print(f"作成しました: {out}（{len(xml) // 1024} KB）")
