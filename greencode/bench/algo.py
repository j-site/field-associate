"""手法1 アルゴリズムを変える：重複の検出  O(n^2) → O(n)"""
import os, random, sys
random.seed(1)
N = int(os.environ.get("N", 6000))
data = [random.randrange(N * 10) for _ in range(N)]

def naive(xs):            # 全ペアを比較する素朴な書き方
    dup = set()
    for i in range(len(xs)):
        for j in range(i + 1, len(xs)):
            if xs[i] == xs[j]:
                dup.add(xs[i])
    return dup

def fast(xs):             # 一度見たものを集合で覚える
    seen, dup = set(), set()
    for x in xs:
        if x in seen:
            dup.add(x)
        seen.add(x)
    return dup

result = naive(data) if sys.argv[1] == "before" else fast(data)
assert result == fast(data)   # 改善前後で答えが同じであることを保証する
print(len(result))
