#!/usr/bin/env bash
# Keep ONLY the hunks that add the openVisualization work, drop everything else.
# usage: filter.sh <in.patch> <out.patch> <1-based hunk numbers to keep>
set -euo pipefail
in="$1"; out="$2"; keep="$3"
python - "$in" "$out" "$keep" <<'PY'
import sys
inp, outp, keep = sys.argv[1], sys.argv[2], set(int(x) for x in sys.argv[3].split(",") if x)
lines = open(inp, encoding="utf-8").read().split("\n")
# header = everything before the first @@
i = 0
while i < len(lines) and not lines[i].startswith("@@"):
    i += 1
header = lines[:i]
body = lines[i:]
# split into hunks
hunks, cur = [], None
for ln in body:
    if ln.startswith("@@"):
        if cur is not None: hunks.append(cur)
        cur = [ln]
    else:
        if cur is not None: cur.append(ln)
if cur is not None: hunks.append(cur)
def counts(h):
    old = sum(1 for l in h[1:] if l.startswith((" ", "-")))
    new = sum(1 for l in h[1:] if l.startswith((" ", "+")))
    return old, new
out = list(header)
for n, h in enumerate(hunks, 1):
    if n not in keep:
        continue
    old, new = counts(h)
    out.append("@@ -%s +%s @@" % (h[0].split("@@")[1].strip().split(" ")[0].split(",")[0][1:],
                                    h[0].split("@@")[1].strip().split(" ")[1][1:]))
    # rebuild header with correct counts
    src = h[0][4:].split("@@")[0].strip()
    parts = src.split(" ")
    start_o = parts[0].lstrip("-").split(",")[0]
    start_n = parts[1].lstrip("+").split(",")[0]
    out[-1] = "@@ -%s,%d +%s,%d @@%s" % (start_o, old, start_n, new, (" " + parts[2]) if len(parts) > 2 else "")
    out.extend(h[1:])
open(outp, "w", encoding="utf-8").write("\n".join(out))
print("kept hunks %s of %d -> %s" % (sorted(keep), len(hunks), outp))
PY