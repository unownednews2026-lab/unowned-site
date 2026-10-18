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
  /* Home page: roll each "Trending now" card forward to that story's most recently ADDED item (not its latest-dated one), so late-arriving news shows up as the headline line. */
  function refreshTrending(items) {
    document.querySelectorAll(".trend[data-story]").forEach(function (li) {
      var slug = li.getAttribute("data-story");
      var top = items.filter(function (i) { return i.story === slug; })[0];
      var line = li.querySelector(".latest-line");
      if (!top || !line) return;
      var t = top.text.replace(/\.$/, "");
      if (t.length > 120) t = t.slice(0, t.lastIndexOf(" ", 120)) + "…"; else t += ".";
      line.textContent = "";
      var b = document.createElement("strong"); b.textContent = "Latest: ";
      line.appendChild(b); line.appendChild(document.createTextNode(t));
      var a = li.querySelector(".story-card");
      if (a && top.id) a.setAttribute("href", "/" + slug + "/#" + top.id);
    });
  }
  function check() {
    if (document.hidden) return;
    fetch("/live.json", { cache: "no-store", credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (items) {
        refreshTrending(items);
        var fresh = items.filter(function (i) { return i.added > newest && (!story || i.story === story); });
        if (fresh.length) show(fresh);
      }).catch(function () {});
  }
  setInterval(check, 60000);
  if (document.querySelector(".trend[data-story]")) check();
  document.addEventListener("visibilitychange", function () { if (!document.hidden) check(); });
})();
