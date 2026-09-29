"""手法5 まとめて処理する：1件ずつ確定させずにまとめて書き込む"""
import os, sqlite3, sys, tempfile
ROWS = 3000
path = os.path.join(tempfile.mkdtemp(), "bench.db")
con = sqlite3.connect(path, isolation_level=None)
con.execute("CREATE TABLE t (id INTEGER, v TEXT)")
rows = [(i, f"value-{i}") for i in range(ROWS)]
if sys.argv[1] == "before":
    for r in rows:                      # 1件ごとに確定（ディスク同期が毎回走る）
        con.execute("INSERT INTO t VALUES (?, ?)", r)
else:
    con.execute("BEGIN")
    con.executemany("INSERT INTO t VALUES (?, ?)", rows)
    con.execute("COMMIT")
assert con.execute("SELECT COUNT(*) FROM t").fetchone()[0] == ROWS
print(ROWS)
