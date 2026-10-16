/* Up/down votes on stories, and "Trending now" ordering. Without JavaScript the list stays in update order. */
(function () {
  "use strict";
  var KEY = "unowned-votes";
  function mine() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  var widgets = document.querySelectorAll(".votes[data-story]");
  if (!widgets.length) return;
  var counts = {};

  function score(slug) { var c = counts[slug] || { up: 0, down: 0 }; return c.up - c.down; }
  function paint() {
    var my = mine();
    widgets.forEach(function (w) {
      var slug = w.getAttribute("data-story"), c = counts[slug] || { up: 0, down: 0 };
      w.querySelector(".score").textContent = String(c.up - c.down);
      w.querySelector(".score").title = c.up + " up, " + c.down + " down";
      w.querySelector(".up").setAttribute("aria-pressed", String(my[slug] === "up"));
      w.querySelector(".down").setAttribute("aria-pressed", String(my[slug] === "down"));
    });
  }
  function reorder() {
    var list = document.querySelector(".trending");
    if (!list) return;
    var items = Array.prototype.slice.call(list.children);
    items.sort(function (a, b) {
      return (score(b.getAttribute("data-story")) - score(a.getAttribute("data-story"))) || (Number(a.getAttribute("data-order")) - Number(b.getAttribute("data-order")));
    });
    items.forEach(function (li, i) { list.appendChild(li); var r = li.querySelector(".rank"); if (r) r.textContent = String(i + 1); });
  }
  function send(slug, vote, prev) {
    var body = new URLSearchParams({ story: slug, vote: vote, prev: prev });
    return fetch("/api/votes", { method: "POST", body: body, credentials: "omit", referrerPolicy: "no-referrer" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); });
  }
  widgets.forEach(function (w) {
    var slug = w.getAttribute("data-story");
    ["up", "down"].forEach(function (dir) {
      w.querySelector("." + dir).addEventListener("click", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var my = mine(), prev = my[slug] || "none", next = prev === dir ? "none" : dir;
        my[slug] = next; save(my);
        var c = counts[slug] || (counts[slug] = { up: 0, down: 0 });
        if (prev !== "none") c[prev] = Math.max(0, c[prev] - 1);
        if (next !== "none") c[next] += 1;
        paint();
        send(slug, next, prev).then(function (res) { counts[slug] = { up: res.up, down: res.down }; paint(); reorder(); })
          .catch(function () { my[slug] = prev; save(my); paint(); });
      });
    });
  });
  paint();
  fetch("/api/votes", { credentials: "omit" }).then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (data) { counts = data || {}; paint(); reorder(); }).catch(function () {});
})();
