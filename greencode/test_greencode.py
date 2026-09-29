"""greencode のテスト:  python3 -m unittest test_greencode"""
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import greencode  # noqa: E402

PY = sys.executable


class EstimateMode(unittest.TestCase):
    def setUp(self):
        # 電力センサーが無い環境として固定する（実行環境に左右されないように）
        patcher = mock.patch.object(greencode, "rapl_domains", return_value=[])
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_energy_is_cpu_time_times_watts(self):
        r = greencode.measure(f"{PY} -c 'sum(range(3_000_000))'", repeat=1, watts=10)
        self.assertAlmostEqual(r["energy_j"], r["cpu_s"] * 10, places=9)
        self.assertIn("推定", r["method"])

    def test_co2_follows_grid_factor(self):
        r = greencode.measure(f"{PY} -c 'sum(range(3_000_000))'", repeat=1, watts=10, grid=0.5)
        expected_g = r["energy_j"] / 3.6e6 * 0.5 * 1000
        self.assertAlmostEqual(r["co2_g"], expected_g, places=12)

    def test_heavier_work_uses_more_energy(self):
        light = greencode.measure(f"{PY} -c 'sum(range(100_000))'", repeat=3)
        heavy = greencode.measure(f"{PY} -c 'sum(range(20_000_000))'", repeat=3)
        self.assertGreater(heavy["energy_j"], light["energy_j"])

    def test_per_unit_values(self):
        r = greencode.measure(f"{PY} -c 'pass'", repeat=1, units=1000)
        self.assertAlmostEqual(r["energy_mj_per_unit"], r["energy_j"] * 1000 / 1000)
        self.assertAlmostEqual(r["sci_mg_per_unit"], r["co2_g"] * 1000 / 1000)

    def test_failing_command_is_reported_not_measured(self):
        # 失敗した処理の「省エネ」を計測しても意味がないのでエラーにする
        with self.assertRaises(RuntimeError):
            greencode.measure(f"{PY} -c 'raise SystemExit(3)'", repeat=1)


class RaplReading(unittest.TestCase):
    def test_counter_wraparound(self):
        # カウンタが上限を超えて0に戻っても正しい差分を出す
        domains = [("dummy", 1_000_000)]
        j = greencode.rapl_delta_joules(domains, [900_000], [100_000])
        self.assertAlmostEqual(j, 0.2)

    def test_sums_packages(self):
        domains = [("a", 10**12), ("b", 10**12)]
        j = greencode.rapl_delta_joules(domains, [0, 0], [1_000_000, 3_000_000])
        self.assertAlmostEqual(j, 4.0)

    def test_reads_only_top_level_domains(self):
        # intel-rapl:0:0 のようなサブ領域を足すと二重計上になるので除外する
        with tempfile.TemporaryDirectory() as root:
            for name, energy in [("intel-rapl:0", 500), ("intel-rapl:0:0", 300), ("intel-rapl:1", 700)]:
                os.makedirs(os.path.join(root, name))
                with open(os.path.join(root, name, "energy_uj"), "w") as f:
                    f.write(str(energy))
                with open(os.path.join(root, name, "max_energy_range_uj"), "w") as f:
                    f.write("262143328850")
            with mock.patch.object(greencode, "RAPL_ROOT", root):
                domains = greencode.rapl_domains()
        self.assertEqual(len(domains), 2)
        self.assertTrue(all(":0:0" not in p for p, _ in domains))

    def test_measured_mode_uses_rapl(self):
        domains = [("x", 10**12)]
        counter = iter([[0], [2_000_000]])  # 2J
        with mock.patch.object(greencode, "rapl_domains", return_value=domains), \
             mock.patch.object(greencode, "read_rapl", side_effect=lambda d: next(counter)):
            r = greencode.measure(f"{PY} -c 'pass'", repeat=1)
        self.assertAlmostEqual(r["energy_j"], 2.0)
        self.assertIn("実測", r["method"])


class Cli(unittest.TestCase):
    def test_compare_json(self):
        import io, json, contextlib
        out = io.StringIO()
        with mock.patch.object(greencode, "rapl_domains", return_value=[]), contextlib.redirect_stdout(out):
            code = greencode.main(["compare", "--repeat", "1", "--json",
                                   "--before", f"{PY} -c 'sum(range(5_000_000))'",
                                   "--after", f"{PY} -c 'pass'"])
        self.assertEqual(code, 0)
        data = json.loads(out.getvalue())
        self.assertGreater(data["before"]["energy_j"], data["after"]["energy_j"])


if __name__ == "__main__":
    unittest.main()
