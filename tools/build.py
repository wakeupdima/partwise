#!/usr/bin/env python3
"""Build index.html for the Partwise landing.

- Cleans the SVG exports from Figma (removes ancestor frames / canvas rect),
  keeps only the illustration subtree, tags animated layers with data-n="<figma id>".
- Re-inserts animated layers that Figma omits from SVG export because their
  initial opacity is 0 (geometry read through the Plugin API).
- Converts Figma Motion keyframes (get_motion_context) into CSS @keyframes.
- Inlines everything into src/index.html -> index.html.

Usage: python3 -I tools/build.py <svg-dir> <motion-dir>
"""
import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SVGNS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVGNS)
ET.register_namespace("xhtml", "http://www.w3.org/1999/xhtml")
Q = lambda t: "{%s}%s" % (SVGNS, t)


def dec(s):
    s = html.unescape(s)
    try:
        return s.encode("latin1").decode("utf8")
    except Exception:
        return s


# ---- illustration definitions -------------------------------------------------
# key: (file, root layer name, {figma node id: svg id}, viewBox w, h)
ILLUS = {
    "hero": ("hero.svg", "Component · DDR-60G-24 on DIN rail", {
        "278:3023": "Circuit assembly · schematic", "278:3080": "Group_14", "278:3090": "Group_15",
        "278:3100": "Group_16", **{f"278:{3110 + i}": f"Vector_{225 + i}" for i in range(34)},
        "278:3144": "DC OK", "278:3145": "MEAN WELL", "278:3146": "DDR-60G-24",
        "278:3147": "9–36 V DC / 24 V DC", "278:3148": "60 W"}),
    "f05": ("f05.svg", "Illustration · SPBW06F-05 · Editable isometric artwork", {}),
    "f12": ("f12.svg", "Illustration · 04 · Datasheet check · animated", {
        "278:3342": "Module", "278:3355": "Contact", "278:3357": "Slider", "278:3372": "Reading closed"}),
    "f15": ("f15.svg", "Illustration · SPBW06F-15 · Editable isometric artwork", {}),
    "g05": ("g05.svg", "Illustration · 02 · Exploded module · animated", {
        "278:3525": "Inner board", "278:3558": "Case"}),
    "g12": ("g12.svg", "Illustration · SPBW06G-12 · Editable isometric artwork", {}),
    "g15": ("g15.svg", "Illustration · 05 · Six-model tray · animated", {
        "278:3774": "Body", "278:3793": "Body_2", "278:3812": "Body_3", "278:3831": "Body_4",
        "278:3850": "Body_5", "278:3869": "Body_6"}),
    "how": ("how.svg", "Illustration · 03 · Factory tube · animated", {
        "278:3930": "Tube module 1", "278:3938": "Tube module 2", "278:3946": "Tube module 3",
        "278:3964": "Tube mouth", "278:3972": "Body"}),
}


# ---- layers with opacity 0 in Figma (not present in SVG export) ---------------
def pins(n, w, h, sx, sy, sw):
    """Row of isometric pins (front face + side face), as in Figma 'Pins' layers."""
    out = []
    for i in range(n):
        x, y = i * sx, i * sy
        out.append(
            f'<path d="M{x + w:.2f} {y + h:.2f}L{x + w * 1.33:.2f} {y + h - w * .27:.2f}L{x + w * 1.33:.2f} {y - w * .27 + .27:.2f}'
            f'L{x + w:.2f} {y:.2f}Z" fill="#8f9cad" stroke="#5d6b7d" stroke-width="{sw}"/>'
            f'<path d="M{x:.2f} {y + h:.2f}L{x + w:.2f} {y + h + w * .56:.2f}L{x + w:.2f} {y + w * .56:.2f}L{x:.2f} {y:.2f}Z" '
            f'fill="#b9c4d1" stroke="#5d6b7d" stroke-width="{sw}"/>')
    return "".join(out)


HL = ('<path d="M16.29 0L47.61 18.08L31.33 27.48L0 9.4Z" fill="none" stroke="#40528f" stroke-width="0.3"/>')
SH_TRAY = ('<path d="M15.16 0L48.1 19L32.95 27.77L0 8.74Z" fill="#1f2631" opacity="0.22" style="filter:blur(2.02px)"/>')
PINS_TRAY = pins(8, 0.61, 7.67, 3.182, 1.833, 0.23)
TRAY = {  # module index -> offsets (Highlight, Shadow, Pins)
    1: ("278:3767", (72.81, 47.62), "278:3769", (73.56, 50.16), "278:3771", (85.10, 56.67), "278:3774"),
    2: ("278:3786", (38.99, 67.14), "278:3788", (39.75, 69.69), "278:3790", (51.29, 76.20), "278:3793"),
    3: ("278:3805", (109.78, 68.97), "278:3807", (110.53, 71.51), "278:3809", (122.07, 78.02), "278:3812"),
    4: ("278:3824", (75.96, 88.49), "278:3826", (76.71, 91.04), "278:3828", (88.25, 97.55), "278:3831"),
    5: ("278:3843", (146.71, 90.28), "278:3845", (147.46, 92.83), "278:3847", (159.01, 99.34), "278:3850"),
    6: ("278:3862", (112.90, 109.81), "278:3864", (113.65, 112.35), "278:3866", (125.19, 118.86), "278:3869"),
}
EXTRAS = {  # key -> list of (figma id, (dx, dy), fragment, ('before'|'after', anchor figma id))
    "f12": [("278:3374", (117.34, 62.79),
             '<text transform="matrix(0.87 0.5 0 1 0 0)" x="0.3" y="8.05" font-family="JetBrains Mono, monospace" '
             'font-weight="500" font-size="7.4" fill="#1f2631">33.80</text>', ("after", "278:3372"))],
    "g05": [("278:3556", (70.22, 63.26),
             '<path d="M26.98 0L86.32 34.26L59.34 49.83L0 15.57Z" fill="#1f2631" opacity="0.28" style="filter:blur(2.84px)"/>',
             ("before", "278:3558"))],
    "g15": [x for i in range(1, 7) for x in (
        (TRAY[i][0], TRAY[i][1], HL, ("before", TRAY[i][6])),
        (TRAY[i][2], TRAY[i][3], SH_TRAY, ("before", TRAY[i][6])),
        (TRAY[i][4], TRAY[i][5], PINS_TRAY, ("before", TRAY[i][6])))],
    "how": [("278:3967", (318.9, 337.14),
             '<path d="M45.59 0L144.88 57.36L99.2 83.68L0 26.41Z" fill="#1f2631" opacity="0.22" style="filter:blur(6.1px)"/>',
             ("before", "278:3972")),
            ("278:3969", (353.6, 345.85), pins(8, 1.92, 23.1, 9.59, 5.58, 0.7), ("before", "278:3972"))],
}


def build_svg(svgdir, key):
    fname, rootname, amap, = ILLUS[key][:3]
    tree = ET.parse(svgdir / fname)
    svg = tree.getroot()
    rev = {v: k for k, v in amap.items()}
    root_g = None
    for el in svg.iter():
        if el.get("id") is not None and dec(el.get("id")) == rootname:
            root_g = el
            break
    assert root_g is not None, (key, rootname)
    defs = svg.find(Q("defs"))
    new = ET.Element(Q("svg"), {
        "viewBox": svg.get("viewBox"), "width": svg.get("width"), "height": svg.get("height"),
        "fill": "none", "class": f"illus illus--{key}", "aria-hidden": "true", "focusable": "false"})
    new.append(root_g)
    if defs is not None:
        new.append(defs)
    defs_ids = set()
    if defs is not None:
        for el in defs.iter():
            if el.get("id"):
                defs_ids.add(el.get("id"))
    parent = {c: p for p in new.iter() for c in p}
    found = set()
    for el in list(new.iter()):
        i = el.get("id")
        if i is None or i in defs_ids:
            continue
        d = dec(i)
        del el.attrib["id"]
        if d in rev:
            nid = rev[d].replace(":", "_")
            found.add(rev[d])
            # wrap so CSS transform never fights an SVG transform attribute
            p = parent[el]
            idx = list(p).index(el)
            wrap = ET.Element(Q("g"), {"data-n": nid})
            p.remove(el)
            wrap.append(el)
            p.insert(idx, wrap)
            parent[wrap] = p
            parent[el] = wrap
    missing = set(amap) - found
    assert not missing, (key, missing)
    s = ET.tostring(new, encoding="unicode")
    # extras
    for nid, (dx, dy), frag, (where, anchor) in EXTRAS.get(key, []):
        g = f'<g data-n="{nid.replace(":", "_")}" class="z0"><g transform="translate({dx} {dy})">{frag}</g></g>'
        m = re.search(r'<g data-n="%s">' % anchor.replace(":", "_"), s)
        assert m, (key, anchor)
        if where == "before":
            s = s[:m.start()] + g + s[m.start():]
        else:  # after: find the matching close of the anchor wrapper
            depth, pos = 0, m.start()
            for t in re.finditer(r"<g\b[^>]*?(/?)>|</g>", s[m.start():]):
                if t.group(0).startswith("</"):
                    depth -= 1
                elif not t.group(1):
                    depth += 1
                if depth == 0:
                    pos = m.start() + t.end()
                    break
            s = s[:pos] + g + s[pos:]
    # unique defs ids per svg
    for i in sorted(defs_ids, key=len, reverse=True):
        s = s.replace(f'id="{i}"', f'id="{key}-{i}"').replace(f"url(#{i})", f"url(#{key}-{i})") \
             .replace(f'href="#{i}"', f'href="#{key}-{i}"')
    s = s.replace("ns0:", "").replace(":ns0", "")
    return s


# ---- motion ------------------------------------------------------------------
VARS = {"--motion-translate-x": "--tx", "--motion-translate-y": "--ty", "--motion-rotate": "--rot",
        "--motion-scale-x": "--sx", "--motion-scale-y": "--sy"}


def motion_css(nodes, skip=()):
    out = []
    for n in nodes:
        nid = n["nodeId"]
        if nid in skip:
            continue
        css = n["codeSnippets"]["css"]
        anim = re.search(r"animation:\s*([^;]+);", css)
        if not anim:
            continue
        sel = f'[data-n="{nid.replace(":", "_")}"]'
        anims = anim.group(1)
        kfs = re.findall(r"@keyframes [^{]+\{(?:[^{}]*\{[^{}]*\})*\s*\}", css)
        for a, b in VARS.items():
            anims = anims.replace(a, b[2:])
            kfs = [k.replace(a, b) for k in kfs]
        anims = re.sub(r"kf_(\d+)_(\d+)_-*", r"kf\1_\2_", anims)
        kfs = [re.sub(r"kf_(\d+)_(\d+)_-*", r"kf\1_\2_", k) for k in kfs]
        names = [x.strip() for x in anims.split(",")]
        anims = ", ".join(x + " infinite" for x in names)
        ox = re.search(r"--motion-origin-x:\s*([\d.]+)", css)
        oy = re.search(r"--motion-origin-y:\s*([\d.]+)", css)
        rule = f"{sel}{{animation:{anims};"
        if ox and oy:
            rule += f"transform-origin:{ox.group(1)}% {oy.group(1)}%;"
        rule += "}"
        out.append(rule)
        out.extend(re.sub(r"\s+", " ", k) for k in kfs)
    return "\n".join(out)


def main():
    svgdir = Path(sys.argv[1])
    motdir = Path(sys.argv[2])
    svgs = {k: build_svg(svgdir, k) for k in ILLUS}
    allm = json.load(open(motdir / "all.json"))["nodes"]
    cat = json.load(open(motdir / "catalogue.json"))["nodes"]
    hero_nodes = [n for n in allm if n["nodeId"].startswith("278:") and n["nodeId"] < "278:3200"]
    # Hero lift: Figma raises the upper module by ~198 px, which slides it over the headline.
    # Keep the same curves/timing but scale the lift so the module stops 16 px below the title
    # (rest top y=309, title bottom y=223 → 70 px of travel out of 190).
    HERO_LIFT_K = 0.37
    def scale_lift(css_text):
        return re.sub(r"(--motion-translate-[xy]:\s*)(-?[\d.]+)",
                      lambda m: m.group(1) + ("%.3f" % (float(m.group(2)) * HERO_LIFT_K)), css_text)
    for n in hero_nodes:
        if n["nodeId"] != "278:2862":
            n["codeSnippets"]["css"] = scale_lift(n["codeSnippets"]["css"])
    css = motion_css(hero_nodes) + "\n" + motion_css(cat) + "\n" + (ROOT / "src" / "how-motion.css").read_text()
    sys.path.insert(0, str(ROOT / "tools"))
    from motion_to_transform import convert
    css, n_exact, n_sampled = convert(css)
    print("motion: exact", n_exact, "sampled", n_sampled)
    (ROOT / "css" / "motion.css").write_text(
        "/* Generated by tools/build.py from Figma Motion (get_motion_context). 12.6 s = 3 × 4.2 s loop.\n"
        "   Plain transform/opacity keyframes (no @property) so the browser can animate cheaply. */\n" + css + "\n")
    tpl = (ROOT / "src" / "index.html").read_text()
    for k, v in svgs.items():
        tpl = tpl.replace(f"<!--SVG:{k}-->", v)
    assert "<!--SVG:" not in tpl
    (ROOT / "index.html").write_text(tpl)
    import subprocess
    subprocess.run([sys.executable, str(ROOT / "tools" / "stamp.py")], check=True)
    print("ok", {k: len(v) for k, v in svgs.items()}, "motion css", len(css))


if __name__ == "__main__":
    main()
