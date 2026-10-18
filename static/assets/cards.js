/* Draws a story's "In 30 seconds" cards as 1080x1350 images (Instagram portrait) that readers can save and share. Runs in the browser; nothing is uploaded. */
(function () {
  "use strict";
  var el = document.getElementById("cards-data"), out = document.getElementById("share-cards");
  if (!el || !out) return;
  var data = JSON.parse(el.textContent);
  var W = 1080, H = 1350, PAD = 84;
  var C = { bg: "#f3f5f7", card: "#ffffff", fg: "#16202b", muted: "#566372", accent: "#1f5f8b", rule: "#d8dee5",
    Confirmed: "#1e7a4c", Reported: "#8a6a12", Disputed: "#a3402e", Alleged: "#6a4f9a", Checking: "#566372" };
  var DISPLAY = '"Archivo Narrow", "Arial Narrow", sans-serif', BODY = '"Noto Sans", system-ui, sans-serif', MONO = '"IBM Plex Mono", monospace';

  function wrap(ctx, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], cur = "";
    words.forEach(function (w) {
      var t = cur ? cur + " " + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function stamp(ctx, label, x, y) {
    ctx.font = "500 26px " + MONO;
    var t = label.toUpperCase(), w = ctx.measureText(t).width + 28;
    ctx.strokeStyle = C[label] || C.muted; ctx.lineWidth = 3;
    if (label === "Checking") ctx.setLineDash([8, 6]);
    ctx.strokeRect(x, y - 30, w, 42); ctx.setLineDash([]);
    ctx.fillStyle = C[label] || C.muted; ctx.fillText(t, x + 14, y);
    return w;
  }

  function draw(card, i, n) {
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.card; ctx.fillRect(40, 40, W - 80, H - 80);
    ctx.fillStyle = C.accent; ctx.fillRect(40, 40, W - 80, 10);
    // Wordmark and counter
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 52px " + DISPLAY; ctx.fillStyle = C.fg; ctx.fillText("Un", PAD, 140);
    var uw = ctx.measureText("Un").width; ctx.fillStyle = C.accent; ctx.fillText("owned", PAD + uw, 140);
    ctx.font = "500 28px " + MONO; ctx.fillStyle = C.muted; ctx.textAlign = "right"; ctx.fillText(i + 1 + "/" + n, W - PAD, 140); ctx.textAlign = "left";
    // Story title and card kind
    var y = 220;
    ctx.font = "500 28px " + MONO; ctx.fillStyle = C.muted;
    wrap(ctx, data.title.toUpperCase(), W - 2 * PAD).forEach(function (l) { ctx.fillText(l, PAD, y); y += 40; });
    y += 30;
    ctx.font = "700 84px " + DISPLAY; ctx.fillStyle = C.fg;
    wrap(ctx, card.kind, W - 2 * PAD).forEach(function (l) { ctx.fillText(l, PAD, y + 60); y += 92; });
    y += 50;
    if (card.title) {
      ctx.font = "700 48px " + DISPLAY; ctx.fillStyle = C.fg;
      wrap(ctx, card.title, W - 2 * PAD).forEach(function (l) { ctx.fillText(l, PAD, y); y += 58; });
      y += 20;
    }
    // Lines: pick a size that fits
    var sizes = [44, 40, 36, 32, 28], size, plan;
    for (var s = 0; s < sizes.length; s++) {
      size = sizes[s]; plan = []; var h = 0;
      ctx.font = "400 " + size + "px " + BODY;
      card.lines.forEach(function (l) {
        var head = l.side || l.label || l.date ? 54 : 0;
        var body = wrap(ctx, l.text, W - 2 * PAD);
        plan.push({ l: l, head: head, body: body }); h += head + body.length * size * 1.35 + 36;
      });
      if (y + h < H - 190) break;
    }
    plan.forEach(function (p) {
      if (p.head) {
        var x = PAD;
        if (p.l.side) { ctx.font = "500 26px " + MONO; ctx.fillStyle = C.muted; ctx.fillText(p.l.side.toUpperCase(), x, y + 30); }
        if (p.l.label) x += stamp(ctx, p.l.label, x, y + 32) + 18;
        if (p.l.date) { ctx.font = "500 28px " + MONO; ctx.fillStyle = C.muted; ctx.fillText(p.l.date, x, y + 30); }
        y += p.head;
      }
      ctx.font = "400 " + size + "px " + BODY; ctx.fillStyle = C.fg;
      p.body.forEach(function (t) { y += size * 1.35; ctx.fillText(t, PAD, y - size * 0.3); });
      y += 36;
    });
    // Footer
    ctx.fillStyle = C.rule; ctx.fillRect(PAD, H - 170, W - 2 * PAD, 2);
    ctx.font = "400 30px " + BODY; ctx.fillStyle = C.muted;
    ctx.fillText("Full timeline and every source:", PAD, H - 118);
    ctx.font = "600 34px " + BODY; ctx.fillStyle = C.accent;
    ctx.fillText(data.site + "/" + data.slug, PAD, H - 72);
    return cv;
  }

  function render() {
    out.innerHTML = "";
    data.cards.forEach(function (c, i) {
      var img = new Image();
      img.alt = data.title + ", card " + (i + 1) + ": " + c.kind;
      img.src = draw(c, i, data.cards.length).toDataURL("image/png");
      out.appendChild(img);
    });
  }
  var fonts = ['700 84px "Archivo Narrow"', '400 40px "Noto Sans"', '600 34px "Noto Sans"', '500 28px "IBM Plex Mono"'];
  if (document.fonts && document.fonts.load) Promise.all(fonts.map(function (f) { return document.fonts.load(f); })).then(render, render);
  else render();
})();
