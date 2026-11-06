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
  function quiet() {
    document.querySelectorAll(".quiet-note[data-updated]").forEach(function (el) {
      var t = Date.parse(el.getAttribute("data-updated"));
      if (!isNaN(t)) el.hidden = Date.now() - t < 864e5;   // only after a full day without a new development
    });
  }
  /* "We check for news every hour" must never be shown when checks have stopped. The checks refresh the page's check time
     at least every 2-3 hours; if the last one is older than 5 hours, say so plainly instead of repeating the promise. */
  function claims() {
    document.querySelectorAll(".hourly-claim[data-checked]").forEach(function (el) {
      var t = Date.parse(el.getAttribute("data-checked"));
      if (isNaN(t)) return;
      if (Date.now() - t > 5 * 36e5) {
        if (!el.hasAttribute("data-orig")) el.setAttribute("data-orig", el.textContent);
        var abs = new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        el.textContent = "Our last check for news was " + abs + ". Our checks are running behind, so there may be news we have not added yet.";
        el.classList.add("behind");
      } else if (el.hasAttribute("data-orig")) {
        el.textContent = el.getAttribute("data-orig"); el.classList.remove("behind");
      }
    });
  }
  run(); quiet(); claims();
  setInterval(function () { run(); quiet(); claims(); }, 60000);
})();
