"""Prints the transcript of a YouTube video (captions, any language; English if a translation exists), or nothing.
Used by tools/primary_desk.mjs so a movement's video is judged by what is actually said in it, not only its description.
Two independent routes, because YouTube sometimes refuses one of them from cloud servers:
  1. youtube-transcript-api (YouTube's caption service)
  2. yt-dlp (reads the caption tracks listed on the video page)
Usage: python tools/yt_transcript.py <video id>"""
import json, re, sys, urllib.request

vid = sys.argv[1]
errors = []


def via_api():
    from youtube_transcript_api import YouTubeTranscriptApi
    items = list(YouTubeTranscriptApi().list(vid))
    pick = next((t for t in items if t.language_code.startswith("en") and not t.is_generated), None) \
        or next((t for t in items if t.language_code.startswith("en")), None)
    if not pick and items:
        first = next((t for t in items if not t.is_generated), items[0])
        try:
            pick = first.translate("en") if first.is_translatable else first
        except Exception:
            pick = first
    if not pick:
        return ""
    text = " ".join(s.text.replace("\n", " ") for s in pick.fetch())
    return f"[Transcript, {pick.language_code}{' auto-generated' if pick.is_generated else ''}] {text}"


def via_ytdlp():
    import yt_dlp
    with yt_dlp.YoutubeDL({"quiet": True, "skip_download": True, "no_warnings": True}) as y:
        info = y.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
    tracks = [("manual", info.get("subtitles") or {}), ("auto-generated", info.get("automatic_captions") or {})]
    orig = info.get("language") or ""
    for kind, subs in tracks:
        langs = [l for l in subs if l.startswith("en")] + ([orig] if orig in subs else []) + list(subs)[:1]
        for lang in langs:
            fmt = next((f for f in subs[lang] if f.get("ext") == "json3"), None)
            if not fmt:
                continue
            data = json.loads(urllib.request.urlopen(fmt["url"], timeout=30).read())
            text = " ".join("".join(s.get("utf8", "") for s in ev.get("segs", [])) for ev in data.get("events", []))
            text = re.sub(r"\s+", " ", text).strip()
            if text:
                return f"[Transcript, {lang} {kind}] {text}"
    return ""


for route in (via_api, via_ytdlp):
    try:
        out = route()
        if out:
            print(out[:8000])
            sys.exit(0)
        errors.append(f"{route.__name__}: no captions")
    except SystemExit:
        raise
    except Exception as e:  # blocked, no captions, private video
        errors.append(f"{route.__name__}: {type(e).__name__} {str(e)[:80]}")
print("transcript unavailable: " + "; ".join(errors), file=sys.stderr)
