/* Unowned story page: filters, share buttons and charts. The page is fully readable without this script. */
(function () {
  "use strict";
  var dataEl = document.getElementById("story-data");
  var D = dataEl ? JSON.parse(dataEl.textContent) : null;

  /* ---------- Toast ---------- */
  function toast(msg) {
    var t = document.createElement("div");
    t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  /* ---------- Share ---------- */
  function copy(text) {
    var done = function () { toast("Post copied. Paste it into WhatsApp, X or Instagram."); };
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
      ta.remove();
      ok ? done() : toast("Copy didn't work here. Select the entry text to share it.");
    };
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      navigator.share({ text: text }).catch(function () {});
      return;
    }
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
  }
  document.querySelectorAll("button.share").forEach(function (b) {
    b.addEventListener("click", function () { copy(b.getAttribute("data-post")); });
  });

  /* ---------- Filters ---------- */
  var buttons = document.querySelectorAll(".filters button");
  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      var f = b.getAttribute("data-f");
      buttons.forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      var shown = 0;
      document.querySelectorAll(".phase-block").forEach(function (block) {
        var n = 0;
        block.querySelectorAll("ol.timeline li").forEach(function (li) {
          var on = f === "all" || li.getAttribute("data-label") === f;
          li.hidden = !on; if (on) n++;
        });
        block.hidden = n === 0; shown += n;
      });
      var empty = document.getElementById("tl-empty");
      if (empty) empty.hidden = shown > 0;
    });
  });

  if (!D) return;

  /* ---------- Charts (one scale per chart) ---------- */
  var NS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs, txt) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (txt != null) e.textContent = txt;
    return e;
  }
  function tip(g, txt) { g.appendChild(sv("title", {}, txt)); }
  function hbar(x, y, w, h, cls) {
    var r = Math.min(4, w / 2, h / 2);
    return sv("path", { "class": cls, d: "M" + x + " " + y + "H" + (x + w - r) + "Q" + (x + w) + " " + y + " " + (x + w) + " " + (y + r) + "V" + (y + h - r) + "Q" + (x + w) + " " + (y + h) + " " + (x + w - r) + " " + (y + h) + "H" + x + "Z" });
  }
  function barChart(id, fig, W) {
    var svg = document.getElementById(id); if (!svg) return;
    var L = 118, R = W - 100, bh = 18, gap = 22, top = 14;
    var X = function (v) { return L + (v / fig.max) * (R - L); };
    svg.appendChild(sv("line", { "class": "axis", x1: L, x2: L, y1: top - 6, y2: top + fig.rows.length * (bh + gap) - gap + 6 }));
    fig.rows.forEach(function (row, i) {
      var name = row[0], v = row[1], y = top + i * (bh + gap), g = sv("g", { "class": "hit" });
      var txt = (v >= 1000 ? v.toLocaleString("en") : String(v)) + fig.unit;
      g.appendChild(sv("rect", { x: 0, y: y - 6, width: W, height: bh + 12, fill: "transparent" }));
      g.appendChild(sv("text", { "class": "lab", x: L - 10, y: y + 13, "text-anchor": "end" }, name));
      g.appendChild(hbar(L, y, X(v) - L, bh, "bar"));
      g.appendChild(sv("text", { "class": "val", x: X(v) + 8, y: y + 13 }, txt));
      tip(g, name + ": " + txt); svg.appendChild(g);
    });
  }
  function dayLabel(d) {
    var m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(d.slice(5, 7)) - 1];
    return m + " " + Number(d.slice(8, 10));
  }
  function phaseChart() {
    var svg = document.getElementById("phasechart"); if (!svg) return;
    var L = 16, R = 704, t = function (d) { return Date.parse(d) / 864e5; };
    var TC = D.timelineChart, t0 = t(TC.from), t1 = t(TC.to);
    var X = function (d) { return L + (t(d) - t0) / (t1 - t0) * (R - L); };
    D.phases.forEach(function (p, i) {
      svg.appendChild(sv("rect", { "class": "band" + (i % 2 ? " alt" : ""), x: X(p.start), y: 22, width: Math.max(2, X(p.end) - X(p.start)), height: 46, rx: 4 }));
      svg.appendChild(sv("text", { "class": "lab muted", x: X(p.start) + 4, y: 16 }, p.short));
    });
    TC.ticks.forEach(function (d) {
      svg.appendChild(sv("line", { "class": "grid", x1: X(d), x2: X(d), y1: 22, y2: 92 }));
      svg.appendChild(sv("text", { "class": "val muted", x: X(d) + 3, y: 108 }, TC.tickDays ? dayLabel(d) : dayLabel(d).split(" ")[0]));
    });
    svg.appendChild(sv("line", { "class": "axis", x1: L, x2: R, y1: 92, y2: 92 }));
    D.events.filter(function (e) { return e.milestone; }).forEach(function (e) {
      var g = sv("g", { "class": "hit" });
      g.appendChild(sv("circle", { cx: X(e.date), cy: 45, r: 12, fill: "transparent" }));
      g.appendChild(sv("circle", { "class": "ms" + (e.hot ? " hot" : ""), cx: X(e.date), cy: 45, r: 5 }));
      tip(g, dayLabel(e.date) + ": " + e.milestone); svg.appendChild(g);
    });
    var callout = D.events.find(function (e) { return e.callout; });
    var hot = D.events.filter(function (e) { return e.hot && e.milestone; }).pop();
    if (callout) svg.appendChild(sv("text", { "class": "lab", x: X(callout.date) - 6, y: 84, "text-anchor": "end" }, callout.milestone + ", " + dayLabel(callout.date)));
    if (hot) {
      svg.appendChild(sv("text", { "class": "lab", x: X(hot.date) - 6, y: 136, "text-anchor": "end" }, hot.milestone + ", " + dayLabel(hot.date)));
      svg.appendChild(sv("line", { "class": "axis", x1: X(hot.date), x2: X(hot.date), y1: 52, y2: 124 }));
    }
  }
  function rangeChart(id, fig) {
    var svg = document.getElementById(id); if (!svg) return;
    var W = 720, L = 250, R = 590, max = fig.max, base = fig.rows.length * 34;
    var X = function (v) { return L + v / max * (R - L); };
    fig.ticks.forEach(function (v) {
      svg.appendChild(sv("line", { "class": "grid", x1: X(v), x2: X(v), y1: 8, y2: base + 4 }));
      svg.appendChild(sv("text", { "class": "val muted", x: X(v), y: base + 22, "text-anchor": "middle" }, v.toLocaleString("en")));
    });
    fig.rows.forEach(function (row, i) {
      var name = row[0], a = row[1], b = row[2], txt = row[3], claim = row[4];
      var y = 14 + i * 34, g = sv("g", { "class": "hit" });
      g.appendChild(sv("rect", { x: 0, y: y - 6, width: W, height: 30, fill: "transparent" }));
      g.appendChild(sv("text", { "class": "lab", x: L - 10, y: y + 13, "text-anchor": "end" }, name));
      if (a === b) g.appendChild(hbar(L, y, X(b) - L, 18, claim ? "bar-soft" : "bar"));
      else {
        g.appendChild(sv("rect", { "class": "bar-soft", x: L, y: y, width: X(a) - L, height: 18 }));
        g.appendChild(hbar(X(a), y, X(b) - X(a), 18, "bar"));
      }
      g.appendChild(sv("text", { "class": "val", x: X(b) + 8, y: y + 13 }, txt));
      tip(g, name + ": " + txt); svg.appendChild(g);
    });
  }
  function mapChart() {
    var svg = document.getElementById("mapchart"); if (!svg) return;
    var M = D.map, lon0 = M.lon0, lon1 = M.lon1, lat0 = M.lat0, lat1 = M.lat1, L = 40, R = 680, T = 16, B = 340;
    var X = function (lon) { return L + (lon - lon0) / (lon1 - lon0) * (R - L); };
    var Y = function (lat) { return T + (lat1 - lat) / (lat1 - lat0) * (B - T); };
    M.lonTicks.forEach(function (lon) {
      svg.appendChild(sv("line", { "class": "grid", x1: X(lon), x2: X(lon), y1: T, y2: B }));
      svg.appendChild(sv("text", { "class": "val muted", x: X(lon) + 3, y: B + 14 }, (lon < 0 ? -lon + "°W" : lon + "°E")));
    });
    M.latTicks.forEach(function (lat) {
      svg.appendChild(sv("line", { "class": "grid", x1: L, x2: R, y1: Y(lat), y2: Y(lat) }));
      svg.appendChild(sv("text", { "class": "val muted", x: L - 4, y: Y(lat) + 4, "text-anchor": "end" }, lat + "°N"));
    });
    D.places.forEach(function (p) {
      var g = sv("g", { "class": "hit" });
      g.appendChild(sv("circle", { cx: X(p.lon), cy: Y(p.lat), r: 14, fill: "transparent" }));
      g.appendChild(sv("circle", { "class": "dot", cx: X(p.lon), cy: Y(p.lat), r: p.r }));
      g.appendChild(sv("text", { "class": "lab", x: X(p.lon) + p.dx, y: Y(p.lat) + p.dy, "text-anchor": p.anchor }, p.name));
      tip(g, p.name + ": " + p.desc); svg.appendChild(g);
    });
  }
  Object.keys(D.figures).forEach(function (k) {
    var f = D.figures[k];
    if (f.type === "range") rangeChart("fig-" + k, f); else barChart("fig-" + k, f, 340);
  });
  phaseChart(); mapChart();
})();
/* Highlight the current section in the sticky section bar. */
(function () {
  "use strict";
  var links = document.querySelectorAll(".secnav a[href^='#']");
  if (!links.length || !("IntersectionObserver" in window)) return;
  var map = {};
  links.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      links.forEach(function (a) { a.classList.remove("on"); });
      var a = map[en.target.id];
      if (a) { a.classList.add("on"); a.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    });
  }, { rootMargin: "-70px 0px -70% 0px" });
  Object.keys(map).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
})();
