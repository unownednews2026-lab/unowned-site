/* Post kit: copy the caption, then share the 5 images straight to Instagram from a phone (or download them on a computer). */
(function () {
  "use strict";
  document.querySelectorAll(".post").forEach(function (post) {
    var key = post.getAttribute("data-key"), n = +post.getAttribute("data-n");
    var urls = []; for (var i = 1; i <= n; i++) urls.push("/kit/" + key + "-" + i + ".jpg");
    var strip = post.querySelector(".strip"), msg = post.querySelector(".msg"), cap = post.querySelector("textarea");
    urls.forEach(function (u) { var im = new Image(); im.src = u; im.alt = ""; strip.appendChild(im); });
    var say = function (t) { msg.textContent = t; };
    // Fetch the images ahead of time, so sharing happens straight from the tap (phones require that).
    var files = null;
    Promise.all(urls.map(function (u, i) {
      return fetch(u).then(function (r) { return r.blob(); }).then(function (b) { return new File([b], key + "-" + (i + 1) + ".jpg", { type: "image/jpeg" }); });
    })).then(function (f) { files = f; }).catch(function () {});
    post.querySelector(".copy").addEventListener("click", function () {
      var done = function () { say("Caption copied. Now tap 2 · Share to Instagram."); };
      if (navigator.clipboard) navigator.clipboard.writeText(cap.value).then(done, function () { cap.select(); document.execCommand("copy"); done(); });
      else { cap.select(); document.execCommand("copy"); done(); }
    });
    post.querySelector(".share").addEventListener("click", function () {
      if (!files) { say("Images are still loading. Try again in a second."); return; }
      if (navigator.canShare && navigator.canShare({ files: files })) {
        navigator.share({ files: files }).then(function () { say("Shared. In Instagram, choose Feed, keep all 5 images, paste the caption and post."); }).catch(function () {});
      } else say("Sharing files isn't supported here (it works on phones). Use Download images instead.");
    });
    post.querySelector(".dl").addEventListener("click", function () {
      urls.forEach(function (u, i) {
        setTimeout(function () { var a = document.createElement("a"); a.href = u; a.download = key + "-" + (i + 1) + ".jpg"; document.body.appendChild(a); a.click(); a.remove(); }, i * 400);
      });
      say("Downloading 5 images. In Instagram, choose Create → Post and select all 5 in order.");
    });
  });
})();
