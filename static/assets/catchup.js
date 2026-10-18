/* "Since your last visit": shows only what is new for returning readers.
   Remembers when you last looked at each story in your own browser (localStorage). Nothing is sent to us. */
(function () {
  "use strict";
  var KEY = "unowned-seen";
  var LABEL = { confirmed: "Confirmed", reported: "Reported", disputed: "Disputed", alleged: "Alleged" };
  function load() { try { var v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function now() { return new Date().toISOString().slice(0, 19) + "Z"; }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function when(iso) { var t = Date.parse(iso); return isNaN(t) ? "" : new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  var css = document.createElement("link");
  css.rel = "stylesheet"; css.href = "/assets/catchup.css";
  document.head.appendChild(css);

  var seen = load();
  seen.stories = seen.stories || {};
  var storyBox = document.querySelector(".latest[data-live-story]");
  var slug = storyBox ? storyBox.getAttribute("data-live-story") : "";
  var isHome = !!document.querySelector(".trending");
  if (!slug && !isHome) return;

  /* Record this visit when the reader leaves, so the next visit counts from now. */
  var openedAt = now();
  function record() {
    var s = load(); s.stories = s.stories || {};
    if (slug) s.stories[slug] = openedAt;
    if (isHome) s.home = openedAt;
    save(s);
  }
  window.addEventListener("pagehide", record);
  document.addEventListener("visibilitychange", function () { if (document.hidden) record(); });

  var last = slug ? seen.stories[slug] : seen.home;
  if (!last && !isHome) return; /* first time on this story: everything is new, nothing to highlight */

  fetch("/updates.json", { credentials: "omit" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.items) return;
      if (slug) storyView(data, last); else homeView(data);
    }).catch(function () {});

  function storyView(data, last) {
    var fresh = data.items.filter(function (i) { return i.story === slug && i.added > last; });
    var older = last < data.since;
    if (!fresh.length && !older) return;
    var box = el("section", "catchup");
    box.id = "since";
    box.setAttribute("aria-labelledby", "h-since");
    var head = el("div", "catchup-head");
    var h = el("h2", null, fresh.length ? "Since your last visit: " + plural(fresh.length, "new update", "new updates") + (older ? " or more" : "") : "A lot has changed since your last visit");
    h.id = "h-since";
    head.appendChild(h);
    head.appendChild(el("p", "catchup-when", "You last looked " + when(last) + ". Only what's new is listed here."));
    box.appendChild(head);
    if (fresh.length) {
      var item = function (i) {
        var li = el("li"), a = el("a");
        a.href = "#" + i.id;
        if (LABEL[i.label]) a.appendChild(el("span", "stamp s-" + i.label, LABEL[i.label]));
        a.appendChild(el("span", "catchup-text", i.text.replace(/\.$/, "") + "."));
        li.appendChild(a);
        var node = document.getElementById(i.id);
        if (node) { node.classList.add("is-new"); var top = node.querySelector(".item-top"); if (top) top.insertBefore(el("span", "new-pill", "New"), top.firstChild); }
        return li;
      };
      var ol = el("ol", "catchup-list");
      fresh.slice(0, 4).forEach(function (i) { ol.appendChild(item(i)); });
      box.appendChild(ol);
      if (fresh.length > 4) {
        var more = el("details", "catchup-fold"), sum = el("summary", null, "Show " + (fresh.length - 4) + " more");
        var ol2 = el("ol", "catchup-list");
        fresh.slice(4).forEach(function (i) { ol2.appendChild(item(i)); });
        more.appendChild(sum); more.appendChild(ol2); box.appendChild(more);
      }
    }
    var foot = el("div", "catchup-foot");
    if (older || fresh.length > 4) { var q = el("a", null, "Short on time? Read it in 30 seconds"); q.href = "#quick"; foot.appendChild(q); }
    var done = el("button", null, "Mark all as read");
    done.type = "button";
    done.addEventListener("click", function () {
      openedAt = now(); record();
      box.parentNode.removeChild(box);
      document.querySelectorAll(".is-new").forEach(function (n) { n.classList.remove("is-new"); var p = n.querySelector(".new-pill"); if (p) p.parentNode.removeChild(p); });
    });
    foot.appendChild(done);
    box.appendChild(foot);
    var anchor = document.getElementById("quick") || document.querySelector(".secnav");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor); else document.querySelector("main, body").appendChild(box);
  }

  function homeView(data) {
    var total = 0, storiesWithNews = 0;
    document.querySelectorAll(".trend[data-story]").forEach(function (li) {
      var s = li.getAttribute("data-story");
      var mark = seen.stories[s] || seen.home;
      if (!mark) return;
      var n = data.items.filter(function (i) { return i.story === s && i.added > mark; }).length;
      var capped = mark < data.since;
      if (!n && !capped) return;
      total += n; storiesWithNews += 1;
      var row = li.querySelector(".meta-row");
      if (row) row.appendChild(el("span", "new-badge", n ? n + (capped ? "+" : "") + " new since your visit" : "New since your visit"));
    });
    if (!storiesWithNews) return;
    var head = document.querySelector("#h-stories");
    var box = head && head.closest(".section-head");
    if (!box) return;
    var p = el("p", "catchup-summary", "Since your last visit: " + (total ? plural(total, "new update", "new updates") + " in " : "news in ") + plural(storiesWithNews, "story", "stories") + ". Open a story to see only what's new.");
    box.appendChild(p);
  }
})();
