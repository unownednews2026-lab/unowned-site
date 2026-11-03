"""Prints the transcript of a YouTube video (captions, any language; English if a translation exists), or nothing.
Used by tools/primary_desk.mjs so a movement's video is judged by what is actually said in it, not only its description.
Usage: python tools/yt_transcript.py <video id>"""
import sys

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    vid = sys.argv[1]
    tl = YouTubeTranscriptApi().list(vid)
    items = list(tl)
    pick = next((t for t in items if t.language_code.startswith("en") and not t.is_generated), None) \
        or next((t for t in items if t.language_code.startswith("en")), None)
    if not pick and items:
        first = next((t for t in items if not t.is_generated), items[0])
        try:
            pick = first.translate("en") if first.is_translatable else first
        except Exception:
            pick = first
    if pick:
        text = " ".join(s.text.replace("\n", " ") for s in pick.fetch())
        print(f"[Transcript, {pick.language_code}{' auto-generated' if pick.is_generated else ''}] {text}"[:8000])
except Exception as e:  # blocked, no captions, private video: the desk falls back to the description
    print(f"transcript unavailable: {type(e).__name__}", file=sys.stderr)
