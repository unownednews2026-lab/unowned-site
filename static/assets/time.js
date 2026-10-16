/* Shows "Added 2 hours ago" style times in the reader's own time zone. Without JavaScript the date still shows. */
(function () {
  "use strict";
  function ago(t) {
    var s = (Date.now() - t) / 1000;
    if (s < 0) s = 0;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
    if (s < 86400) { var h = Math.round(s / 3600); return h + (h === 1 ? " hour ago" : " hours ago"); }
    if (s < 172800) return "yesterday";
    return null;
  }
  function run() {
    document.querySelectorAll("time.ago[datetime]").forEach(function (el) {
      var t = Date.parse(el.getAttribute("datetime"));
      if (isNaN(t)) return;
      var base = el.textContent.indexOf("Added") === 0 ? "Added " : "";
      var rel = ago(t);
      var abs = new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      el.textContent = base + (rel || abs);
      el.title = abs;
    });
  }
  run();
  setInterval(run, 60000);
})();
