#!/bin/sh
# 打ち間違いの検出：Roblox の標準の名前以外の「未定義の名前」を表示する。 使い方: tools/check_globals.sh ファイル...
LUAU_ANALYZE="${LUAU_ANALYZE:-luau-analyze}"
"$LUAU_ANALYZE" "$@" 2>&1 | grep -v "^$" | grep -E "Unknown global" \
  | sed -E "s/^(.*)\(([0-9]+),[0-9]+\).*Unknown global '([^']+)'.*/\3 \1:\2/" \
  | grep -v -E "^(game|workspace|task|Instance|Vector3|Vector2|CFrame|Color3|Enum|TweenInfo|UDim2|UDim|Random|typeof|tick|time|wait|delay|spawn|script|shared|warn|Font|ColorSequence|NumberSequence|NumberRange|Rect|Region3|Ray|BrickColor|PhysicalProperties|OverlapParams|RaycastParams|Axes|Faces|DateTime|require|elapsedTime) " || true
