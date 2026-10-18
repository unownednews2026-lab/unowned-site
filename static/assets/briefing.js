/* Daily briefing: inline play buttons (.brief-mini) and the "Copy link" button for the podcast feed.
   Without JavaScript the play button is a plain link to /briefing/. */
(function () {
  "use strict";
  var yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);

  document.querySelectorAll(".brief-mini").forEach(function (box) {
    /* Never promote a stale briefing, even if the page itself is old. */
    if ((box.getAttribute("data-date") || "") < yesterday) { box.hidden = true; return; }
    var btn = box.querySelector(".brief-play"), audio = box.querySelector("audio"), icon = btn && btn.querySelector("span");
    if (!btn || !audio) return;
    var label = btn.getAttribute("aria-label");
    btn.setAttribute("role", "button");
    function paint() {
      var playing = !audio.paused && !audio.ended;
      if (icon) icon.textContent = playing ? "❚❚" : "▶";
      btn.setAttribute("aria-label", playing ? "Pause the briefing" : label);
      box.classList.toggle("is-playing", playing);
    }
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (audio.paused) { audio.play().catch(function () { location.href = "/briefing/"; }); } else { audio.pause(); }
    });
    ["play", "pause", "ended"].forEach(function (e) { audio.addEventListener(e, paint); });
    audio.addEventListener("timeupdate", function () {
      if (!audio.duration) return;
      box.style.setProperty("--brief-progress", (audio.currentTime / audio.duration * 100).toFixed(1) + "%");
    });
  });

  document.querySelectorAll(".copy-feed").forEach(function (b) {
    if (!navigator.clipboard) return;
    b.hidden = false;
    b.addEventListener("click", function () {
      navigator.clipboard.writeText(b.getAttribute("data-copy")).then(function () {
        b.textContent = "Copied";
        setTimeout(function () { b.textContent = "Copy link"; }, 2000);
      }).catch(function () {});
    });
  });
})();
