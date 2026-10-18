"""Turns briefing scripts (content/briefings/YYYY-MM-DD.json) into MP3 files (static/briefings/YYYY-MM-DD.mp3).
Runs in GitHub Actions. Voice: Kokoro "af_heart" (open-source, synthetic). Usage: python tools/briefing_audio.py <model.onnx> <voices.bin>"""
import json, os, subprocess, sys, tempfile
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

model, voices = sys.argv[1], sys.argv[2]
os.makedirs("static/briefings", exist_ok=True)

# Podcast cover art (made once): 1400x1400, brand colours, plain text. Podcast apps require square art of at least 1400px.
if not os.path.exists("static/briefings/cover.png"):
    from PIL import Image, ImageDraw, ImageFont
    def font(size, bold=True):
        for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
            if os.path.exists(f):
                return ImageFont.truetype(f, size)
        return ImageFont.load_default()
    img = Image.new("RGB", (1400, 1400), "#16202b")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 1400, 24], fill="#1f5f8b")
    d.text((110, 470), "Un", font=font(230), fill="#ffffff")
    d.text((110 + d.textlength("Un", font=font(230)), 470), "owned", font=font(230), fill="#6fb0de")
    d.text((116, 760), "DAILY BRIEFING", font=font(78), fill="#e3e9ef")
    d.text((116, 1180), "News nobody owns.", font=font(56, False), fill="#9aa8b6")
    img.save("static/briefings/cover.png")
    print("made cover")
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
