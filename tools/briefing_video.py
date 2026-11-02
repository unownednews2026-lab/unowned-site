"""Makes a vertical (9:16) video of today's headlines from the daily briefing, for Reels, TikTok and YouTube Shorts.
Called by tools/briefing_audio.py right after it records the newest briefing, with each paragraph's spoken length,
so every card changes exactly when the voice moves on. Output (published with the site, for the post kit):
  static/briefings/latest-video.mp4   the opening, the grades explainer and every headline, then a closing card
  static/briefings/latest-video.json  date and a ready-to-paste caption
Only text already in the checked briefing script is shown. No AI step."""
import json, os, re, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
BG, FG, MUTED, ACCENT = "#16202b", "#e3e9ef", "#9aa8b6", "#6fb0de"
GRADE = {"confirmed": "#5fc28f", "reported": "#d8b54f", "disputed": "#ec8a76", "alleged": "#b49ae6"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def fonts():
    from fontTools.ttLib import TTFont
    out = {}
    for name in ["archivo-narrow-latin-700-normal", "noto-sans-latin-400-normal", "noto-sans-latin-600-normal", "ibm-plex-mono-latin-500-normal"]:
        path = os.path.join(tempfile.gettempdir(), name + ".ttf")
        if not os.path.exists(path):
            f = TTFont(f"static/assets/fonts/{name}.woff2"); f.flavor = None; f.save(path)
        out[name] = path
    return {
        "A": lambda s: ImageFont.truetype(out["archivo-narrow-latin-700-normal"], s),
        "N": lambda s: ImageFont.truetype(out["noto-sans-latin-400-normal"], s),
        "B": lambda s: ImageFont.truetype(out["noto-sans-latin-600-normal"], s),
        "M": lambda s: ImageFont.truetype(out["ibm-plex-mono-latin-500-normal"], s),
    }


def wrap(d, text, font, width):
    lines, line = [], ""
    for w in text.split():
        t = (line + " " + w).strip()
        if d.textlength(t, font=font) <= width or not line:
            line = t
        else:
            lines.append(line); line = w
    if line:
        lines.append(line)
    return lines


def fit(d, text, make, width, max_h, start, low):
    """Largest font size (from start down to low) at which text fits the box."""
    for size in range(start, low - 1, -4):
        f = make(size); lines = wrap(d, text, f, width)
        if len(lines) * size * 1.18 <= max_h:
            return f, lines, size
    f = make(low); return f, wrap(d, text, f, width), low


def card(F, kicker, title=None, body=None, grade=None, note=None, rows=None):
    img = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(img)
    x, y, width = 80, 150, W - 160
    big = F["A"](76)
    d.text((x, y), "Un", font=big, fill=FG); d.text((x + d.textlength("Un", font=big), y), "owned", font=big, fill=ACCENT)
    y = 360
    d.text((x, y), kicker.upper(), font=F["M"](36), fill=MUTED); y += 80
    if title:
        f, lines, size = fit(d, title, F["A"], width, 760, 108, 60)
        for ln in lines:
            d.text((x, y), ln, font=f, fill=FG); y += int(size * 1.18)
        y += 40
    if grade:
        gf = F["M"](44); label = grade.upper()
        tw = d.textlength(label, font=gf)
        d.rounded_rectangle([x, y, x + tw + 56, y + 80], radius=14, fill=GRADE[grade])
        d.text((x + 28, y + 14), label, font=gf, fill=BG); y += 130
    if note:
        for ln in wrap(d, note, F["N"](40), width):
            d.text((x, y), ln, font=F["N"](40), fill=MUTED); y += 56
    if body:
        for ln in wrap(d, body, F["N"](48), width):
            d.text((x, y), ln, font=F["N"](48), fill=FG); y += 70
    for name, desc in rows or []:
        d.rectangle([x, y, x + 14, y + 120], fill=GRADE[name])
        d.text((x + 44, y + 4), name.capitalize(), font=F["B"](54), fill=GRADE[name])
        d.text((x + 44, y + 72), desc, font=F["N"](40), fill="#c9d3dc"); y += 170
    d.text((x, H - 260), "Listen to the full briefing", font=F["N"](40), fill=MUTED)
    d.text((x, H - 200), "unownednews.com", font=F["B"](54), fill=ACCENT)
    return img


def make_video(date, b, durs, mp3):
    script = b["script"]
    try:
        start = script.index("Here are today's headlines.")
        end = script.index("Now, more on those stories.")
    except ValueError:
        start = next((i for i, p in enumerate(script) if p.startswith("Here are")), 2); end = len(script) - 1
    F = fonts()
    y, m, dd = map(int, date.split("-"))
    import datetime
    weekday = datetime.date(y, m, dd).strftime("%A")
    heads = script[start + 1:end]
    regions = [h.split(". ", 1)[0] for h in heads]
    cards = [(card(F, "Daily audio briefing", f"{weekday}, {MONTHS[m - 1]} {dd}", body=f"{len(heads)} stories, every claim graded."), durs[0])]
    if start >= 2:   # the grades explainer paragraph
        rows = [("confirmed", "Independent outlets agree."), ("reported", "One source so far."), ("disputed", "The accounts conflict."), ("alleged", "One side's claim.")]
        cards.append((card(F, "How we grade", rows=rows), sum(durs[1:start])))
    cards.append((card(F, "Today's headlines", " · ".join(regions)), durs[start]))
    for i, h in enumerate(heads):
        region, rest = (h.split(". ", 1) + [""])[:2]
        g = re.search(r"\b(?:grade(?: that)?:?|grade for [^.]*? is)\s+(confirmed|reported|disputed|alleged)\b", rest)
        grade = g.group(1) if g else None
        text = re.split(r"\s+(?:Our grade|We grade)", rest)[0].strip()
        tail = rest[g.end():] if g else ""
        note = re.sub(r"^[\s.,:;]+", "", tail).strip()
        note = re.sub(r"^(because|as|resting on)\s+", "", note)
        note = note[:1].upper() + note[1:] if note else ""
        cards.append((card(F, region, text, grade=grade, note=note), durs[start + 1 + i]))
    total = sum(d for _, d in cards)
    tmp = tempfile.mkdtemp()
    lst = []
    for i, (img, dur) in enumerate(cards):
        p = os.path.join(tmp, f"c{i}.png"); img.save(p); lst.append(f"file '{p}'\nduration {dur:.3f}")
    outro = card(F, "Every source. Every grade.", "Full timelines at unownednews.com", body="News nobody owns.")
    po = os.path.join(tmp, "end.png"); outro.save(po); lst += [f"file '{po}'\nduration 3.5", f"file '{po}'"]
    open(os.path.join(tmp, "list.txt"), "w").write("\n".join(lst) + "\n")
    out = "static/briefings/latest-video.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", os.path.join(tmp, "list.txt"), "-i", mp3,
                    "-filter_complex", f"[1:a]atrim=0:{total:.2f},afade=t=out:st={total - 0.6:.2f}:d=0.6,apad=pad_dur=3.5[a];[0:v]fps=24,format=yuv420p[v]",
                    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-tune", "stillimage", "-crf", "26",
                    "-c:a", "aac", "-b:a", "96k", "-t", f"{total + 3.5:.2f}", "-movflags", "+faststart", out], check=True)
    names = ", ".join(regions[:-1]) + (" and " + regions[-1] if len(regions) > 1 else regions[0] if regions else "")
    caption = (f"Today's world briefing: {names}. Every claim graded: confirmed, reported, disputed or alleged. "
               f"AI-narrated, every fact sourced. Full timelines and sources: unownednews.com\n\n#News #WorldNews #FactCheck #MediaLiteracy")
    json.dump({"date": date, "seconds": round(total + 3.5), "caption": caption}, open("static/briefings/latest-video.json", "w"), indent=2)
    print(f"made {out} ({round(total + 3.5)} s)")
