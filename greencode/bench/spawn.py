"""手法4 身の丈に合った道具：処理のたびに重い実行環境を立ち上げない
（1件ごとにプロセス/コンテナ/サーバーレス関数を起動する構成の縮図）"""
import subprocess, sys
ITEMS = 120
WORK = "print(sum(i*i for i in range({n})))"
if sys.argv[1] == "before":
    for n in range(ITEMS):
        subprocess.run([sys.executable, "-c", WORK.format(n=n * 100)], check=True, stdout=subprocess.DEVNULL)
else:
    for n in range(ITEMS):
        sum(i * i for i in range(n * 100))
print(ITEMS)
