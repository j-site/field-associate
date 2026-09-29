/* 手法3 データを動かさない(2)：メモリに並んでいる順に読む
   同じ2次元配列を「行の順」と「列の順」で合計する。計算量は完全に同じ */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define R 8192
#define C 8192
int main(int argc, char **argv) {
  int *a = malloc(sizeof(int) * (size_t)R * C);
  for (size_t i = 0; i < (size_t)R * C; i++) a[i] = (int)(i & 1023);
  long long s = 0;
  if (!strcmp(argv[1], "col")) {
    for (int j = 0; j < C; j++) for (int i = 0; i < R; i++) s += a[(size_t)i * C + j];
  } else {
    for (int i = 0; i < R; i++) for (int j = 0; j < C; j++) s += a[(size_t)i * C + j];
  }
  printf("%lld\n", s);
  return 0;
}
