/* 手法3 データを動かさない(1)：データ型を小さくする
   同じ個数の値を 64bit / 32bit / 8bit で持ち、全体を何度も読む。
   ※8bitで表せる範囲の値にしか使えない。精度が落ちてよいかは用途次第 */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#define N (48u * 1024 * 1024)
#define PASSES 8
int main(int argc, char **argv) {
  const char *m = argv[1];
  long long total = 0;
  if (!strcmp(m, "f64")) {
    double *a = malloc(sizeof(double) * N);
    for (unsigned i = 0; i < N; i++) a[i] = (double)(i & 63);
    double s = 0;
    for (int p = 0; p < PASSES; p++) for (unsigned i = 0; i < N; i++) s += a[i];
    total = (long long)s;
  } else if (!strcmp(m, "f32")) {
    float *a = malloc(sizeof(float) * N);
    for (unsigned i = 0; i < N; i++) a[i] = (float)(i & 63);
    double s = 0;
    for (int p = 0; p < PASSES; p++) for (unsigned i = 0; i < N; i++) s += a[i];
    total = (long long)s;
  } else {
    int8_t *a = malloc(N);
    for (unsigned i = 0; i < N; i++) a[i] = (int8_t)(i & 63);
    long long s = 0;
    for (int p = 0; p < PASSES; p++) for (unsigned i = 0; i < N; i++) s += a[i];
    total = s;
  }
  printf("%lld\n", total);   /* 3つとも同じ値になることを検証に使う */
  return 0;
}
