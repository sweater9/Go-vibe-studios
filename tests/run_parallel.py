#!/usr/bin/env python3
"""Runs tests/test_site.py in parallel slices and combines the result.

Run:  python3 tests/run_parallel.py [workers]     (default: the CPU count, at most 6; more workers than CPUs makes timing sensitive tests flaky)
Each worker starts its own server and browser and runs every Nth test; the run fails if any slice fails.
"""
import os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else min(6, os.cpu_count() or 2)
    t0 = time.time()
    procs = [subprocess.Popen([sys.executable, os.path.join(HERE, "test_site.py"), "--shard", f"{i}/{n}"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) for i in range(1, n + 1)]
    passed = failed = 0
    bad = False
    for i, p in enumerate(procs, 1):
        out = p.communicate()[0]
        m = re.search(r"(\d+) checks passed, (\d+) failed", out)
        if m:
            passed += int(m.group(1)); failed += int(m.group(2))
        if p.returncode != 0 or not m:
            bad = True
            print(f"--- worker {i}/{n} did not pass ---\n" + "\n".join(l for l in out.splitlines() if "BrokenPipe" not in l and l.strip())[-3000:])
    print(f"\n{passed} checks passed, {failed} failed, {n} workers, {time.time() - t0:.0f}s")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
