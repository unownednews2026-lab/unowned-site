/* Daily briefing: inline play buttons (.brief-mini) and the "Copy link" button for the podcast feed.
   Without JavaScript the play button is a plain link to /briefing/. */
(function () {
  "use strict";
  var cutoff = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10); // same 3-day window as the build

  document.querySelectorAll(".brief-mini").forEach(function (box) {
    /* Never promote a stale briefing, even if the page itself is old. */
    if ((box.getAttribute("data-date") || "") < cutoff) { box.hidden = true; return; }
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

/* Daily email sign-up: submits to /api/subscribe without leaving the page. Without JavaScript the form posts normally. */
(function () {
  "use strict";
  document.querySelectorAll("form.signup").forEach(function (form) {
    var msg = form.querySelector(".signup-msg");
    var btn = form.querySelector("button[type=submit]");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      msg.hidden = true; msg.className = "signup-msg";
      btn.disabled = true; btn.textContent = "Signing up…";
      fetch(form.action, { method: "POST", body: new URLSearchParams(new FormData(form)), headers: { "Accept": "application/json" }, credentials: "omit", referrerPolicy: "no-referrer" })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          msg.hidden = false;
          msg.classList.add(res.ok ? "ok" : "err");
          msg.textContent = res.ok ? res.j.message : (res.j.error || "Sign-up didn't work. Please try again.");
          if (res.ok) form.reset();
        })
        .catch(function () {
          msg.hidden = false; msg.classList.add("err");
          msg.textContent = "We couldn't reach the server. Check your connection and try again.";
        })
        .finally(function () { btn.disabled = false; btn.textContent = "Sign up"; });
    });
  });
})();
