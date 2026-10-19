"""Turns briefing scripts (content/briefings/YYYY-MM-DD.json) into MP3 files (static/briefings/YYYY-MM-DD.mp3).
Runs in GitHub Actions. Voice: Kokoro "af_heart" (open-source, synthetic). Usage: python tools/briefing_audio.py <model.onnx> <voices.bin>"""
import json, os, subprocess, sys, tempfile
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

model, voices = sys.argv[1], sys.argv[2]
os.makedirs("static/briefings", exist_ok=True)

# Podcast cover art: 3000x3000 (Apple's recommended size), in the site's own fonts. Remade only if missing or smaller.
def make_cover(path="static/briefings/cover.png"):
    from PIL import Image, ImageDraw, ImageFont
    if os.path.exists(path) and Image.open(path).size[0] >= 3000:
        return
    from fontTools.ttLib import TTFont
    fonts = {}
    for name in ["archivo-narrow-latin-700-normal", "noto-sans-latin-400-normal", "ibm-plex-mono-latin-500-normal"]:
        f = TTFont(f"static/assets/fonts/{name}.woff2"); f.flavor = None
        out = os.path.join(tempfile.gettempdir(), name + ".ttf"); f.save(out); fonts[name] = out
    A = lambda s: ImageFont.truetype(fonts["archivo-narrow-latin-700-normal"], s)
    N = lambda s: ImageFont.truetype(fonts["noto-sans-latin-400-normal"], s)
    M = lambda s: ImageFont.truetype(fonts["ibm-plex-mono-latin-500-normal"], s)
    img = Image.new("RGB", (3000, 3000), "#16202b"); d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 3000, 60], fill="#1f5f8b")
    x, big = 230, A(640)
    d.text((x, 880), "Un", font=big, fill="#ffffff")
    d.text((x + d.textlength("Un", font=big), 880), "owned", font=big, fill="#6fb0de")
    d.text((x + 10, 1700), "DAILY BRIEFING", font=M(190), fill="#e3e9ef")
    d.rectangle([x + 10, 1980, x + 700, 1996], fill="#6fb0de")
    d.text((x + 10, 2560), "News nobody owns.", font=N(130), fill="#9aa8b6")
    img.save(path, optimize=True)
    print("made cover")
make_cover()
k = Kokoro(model, voices)
made = 0
for name in sorted(os.listdir("content/briefings")):
    if not name.endswith(".json"):
        continue
    date = name[:-5]
    out = f"static/briefings/{date}.mp3"
    if os.path.exists(out):
        continue
    b = json.load(open(f"content/briefings/{name}"))
    parts, sr = [], 24000
    for para in b["script"]:
        audio, sr = k.create(para, voice="af_heart", speed=1.0, lang="en-us")
        parts += [audio, np.zeros(int(sr * 0.45), dtype=audio.dtype)]
    with tempfile.NamedTemporaryFile(suffix=".wav") as wav:
        sf.write(wav.name, np.concatenate(parts), sr)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav.name, "-ar", "44100", "-ac", "2", "-codec:a", "libmp3lame", "-b:a", "128k", out], check=True)
    made += 1
    print("made", out)
print(f"{made} new briefing(s)")
