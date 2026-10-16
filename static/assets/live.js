/* Keeps pages live: checks for newly published updates every minute and offers to show them. */
(function () {
  "use strict";
  var box = document.querySelector("[data-newest]");
  if (!box) return;
  var story = box.getAttribute("data-live-story");
  var newest = box.getAttribute("data-newest") || "";
  var bar = null;
  function show(items) {
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "newbar";
      bar.setAttribute("role", "status");
      bar.innerHTML = '<span class="live-dot" aria-hidden="true"></span><span class="newbar-text"></span><button type="button">Show</button>';
      bar.querySelector("button").addEventListener("click", function () { location.reload(); });
      document.body.appendChild(bar);
    }
    var first = items[0];
    bar.querySelector(".newbar-text").textContent = (items.length === 1 ? "New update" : items.length + " new updates") + ": " + first.text.slice(0, 90) + (first.text.length > 90 ? "…" : "");
  }
  function check() {
    if (document.hidden) return;
    fetch("/live.json", { cache: "no-store", credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (items) {
        var fresh = items.filter(function (i) { return i.added > newest && (!story || i.story === story); });
        if (fresh.length) show(fresh);
      }).catch(function () {});
  }
  setInterval(check, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) check(); });
})();
