"""Convert custom-property motion (--tx/--ty/--rot/--sx/--sy keyframes) into plain
transform/opacity keyframes so browsers don't recalc styles for @property every frame.

Tracks of one element that share the same stops and timing functions are merged
exactly; otherwise they are evaluated with their own easing and sampled every 0.5 %.
"""
import re

PROPS = {"--tx": "tx", "--ty": "ty", "--rot": "rot", "--sx": "sx", "--sy": "sy"}
DEFAULT = {"tx": 0.0, "ty": 0.0, "rot": 0.0, "sx": 1.0, "sy": 1.0}
NAMED = {"linear": None, "ease": (0.25, 0.1, 0.25, 1), "ease-in": (0.42, 0, 1, 1),
         "ease-out": (0, 0, 0.58, 1), "ease-in-out": (0.42, 0, 0.58, 1)}


def bezier(x1, y1, x2, y2):
    def bx(t): return 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3
    def by(t): return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3
    def f(x):
        lo, hi = 0.0, 1.0
        for _ in range(40):
            mid = (lo + hi) / 2
            if bx(mid) < x: lo = mid
            else: hi = mid
        return by((lo + hi) / 2)
    return f


def ease_fn(name):
    name = (name or "linear").strip()
    if name == "step-end": return lambda x: 0.0 if x < 1 else 1.0
    if name == "step-start": return lambda x: 1.0
    if name in NAMED:
        c = NAMED[name]
        return (lambda x: x) if c is None else bezier(*c)
    m = re.match(r"cubic-bezier\(([^)]*)\)", name)
    if m: return bezier(*[float(v) for v in m.group(1).split(",")])
    return lambda x: x


def parse_kf(body):
    """-> list of (pct, {prop: value}, timing or None)"""
    out = []
    for m in re.finditer(r"([\d.]+)%\s*\{([^}]*)\}", body):
        decl = dict((k.strip(), v.strip()) for k, v in
                    (d.split(":", 1) for d in m.group(2).split(";") if ":" in d))
        timing = decl.pop("animation-timing-function", None)
        out.append((float(m.group(1)), decl, timing))
    return out


def track_value(stops, prop, p):
    """Value of a single-property track at percentage p using per-segment easing."""
    pts = [(pc, float(d[prop]), t) for pc, d, t in stops if prop in d]
    if p <= pts[0][0]: return pts[0][1]
    for (a, va, ta), (b, vb, _) in zip(pts, pts[1:]):
        if a <= p <= b:
            if b == a: return vb
            return va + (vb - va) * ease_fn(ta)((p - a) / (b - a))
    return pts[-1][1]


def fmt(v):
    s = ("%.3f" % v).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def transform_str(v):
    parts = []
    if v["tx"] or v["ty"]: parts.append(f"translate({fmt(v['tx'])}px,{fmt(v['ty'])}px)")
    if v["rot"]: parts.append(f"rotate({fmt(v['rot'])}deg)")
    if v["sx"] != 1 or v["sy"] != 1: parts.append(f"scale({fmt(v['sx'])},{fmt(v['sy'])})")
    return " ".join(parts) or "none"


def convert(css):
    keyframes = {m.group(1): m.group(2) for m in re.finditer(r"@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}", css)}
    rules = re.findall(r"(\[data-n=\"[\w]+\"\])\s*\{\s*animation:\s*([^;]+);([^}]*)\}", css)
    out, n_exact, n_sampled = [], 0, 0
    for sel, anims, rest in rules:
        groups, opac = {}, []
        for a in anims.split(","):
            tok = a.split()
            name, dur = tok[0], tok[1]
            delay = next((t for t in tok[2:] if re.fullmatch(r"-?[\d.]+m?s", t)), "0s")
            stops = parse_kf(keyframes[name])
            props = {k for _, d, _ in stops for k in d}
            if props & set(PROPS):
                groups.setdefault((dur, delay), []).append((name, stops))
            else:
                opac.append(f"{name} {dur} linear {delay} infinite both")
        anim_list = list(opac)
        for i, ((dur, delay), tracks) in enumerate(groups.items()):
            kname = "t" + sel[9:-2] + ("_%d" % i if i else "")
            sigs = {tuple((pc, t) for pc, _, t in st) for _, st in tracks}
            vals_at = lambda p: {PROPS[k]: track_value(st, k, p) for _, st in tracks
                                 for k in {kk for _, d, _ in st for kk in d} if k in PROPS}
            body = []
            if len(sigs) == 1:  # identical stops & easing → exact merge
                n_exact += 1
                for pc, _, t in tracks[0][1]:
                    v = dict(DEFAULT); v.update(vals_at(pc))
                    body.append(f"{fmt(pc)}%{{transform:{transform_str(v)}" + (f";animation-timing-function:{t}" if t else "") + "}")
            else:  # sample each track with its own easing
                n_sampled += 1
                pts = sorted({pc for _, st in tracks for pc, _, _ in st} | {x / 2 for x in range(201)})
                for pc in pts:
                    v = dict(DEFAULT); v.update(vals_at(pc))
                    body.append(f"{fmt(pc)}%{{transform:{transform_str(v)}}}")
            out.append(f"@keyframes {kname}{{{''.join(body)}}}")
            anim_list.append(f"{kname} {dur} linear {delay} infinite both")
        extra = rest.strip()
        out.append(f"{sel}{{animation:{', '.join(anim_list)};{extra}}}")
        for a in opac:
            nm = a.split()[0]
            kb = re.sub(r"\s+", " ", keyframes[nm]).strip()
            out.append("@keyframes %s{%s}" % (nm, kb))
    return "\n".join(out), n_exact, n_sampled
