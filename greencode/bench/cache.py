"""手法2 やらない：同じ計算を繰り返さない（キャッシュ）
実際のリクエストは偏る（一部の人気商品・よく使う問い合わせに集中する）ためZipf分布で再現"""
import random, sys
random.seed(2)
KEYS, REQUESTS = 500, 3000
weights = [1 / (k + 1) for k in range(KEYS)]
requests = random.choices(range(KEYS), weights=weights, k=REQUESTS)

def expensive(k):          # 重い処理の代わり（DB集計・外部API・推論など）
    n = 2000 + k * 7
    sieve = bytearray([1]) * (n + 1)
    sieve[0:2] = b"\x00\x00"
    for i in range(2, int(n ** 0.5) + 1):
        if sieve[i]:
            sieve[i * i::i] = bytearray(len(sieve[i * i::i]))
    return sum(i for i in range(n + 1) if sieve[i])

if sys.argv[1] == "before":
    total = sum(expensive(k) for k in requests)
else:
    memo = {}
    total = 0
    for k in requests:
        if k not in memo:
            memo[k] = expensive(k)
        total += memo[k]
print(total)
