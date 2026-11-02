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

/* Today's briefing video: caption from latest-video.json; share the MP4 straight to TikTok, Instagram or YouTube from a phone. */
(function () {
  "use strict";
  var box = document.getElementById("video"); if (!box) return;
  var cap = box.querySelector("textarea"), msg = box.querySelector(".msg"), vid = box.querySelector("video");
  var say = function (t) { msg.textContent = t; };
  var file = null, name = "unowned-briefing.mp4";
  fetch("/briefings/latest-video.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (j) {
    cap.value = j.caption; name = "unowned-briefing-" + j.date + ".mp4";
    vid.src = "/briefings/latest-video.mp4?v=" + j.date;
    box.querySelector("h2").textContent = "Briefing video · " + j.date + " · " + j.seconds + " s";
    return fetch("/briefings/latest-video.mp4?v=" + j.date).then(function (r) { return r.blob(); });
  }).then(function (b) { file = new File([b], name, { type: "video/mp4" }); }).catch(function () { cap.value = "No video yet today."; });
  box.querySelector(".vcopy").addEventListener("click", function () {
    var done = function () { say("Caption copied. Now tap 2 · Share video and pick TikTok, Instagram or YouTube."); };
    if (navigator.clipboard) navigator.clipboard.writeText(cap.value).then(done, function () { cap.select(); document.execCommand("copy"); done(); });
    else { cap.select(); document.execCommand("copy"); done(); }
  });
  box.querySelector(".vshare").addEventListener("click", function () {
    if (!file) { say("The video is still loading. Try again in a few seconds."); return; }
    if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file] }).then(function () { say("Shared. Paste the caption in the app and post."); }).catch(function () {});
    else say("Sharing a video isn't supported here (it works on phones). Use Download video instead.");
  });
  box.querySelector(".vdl").addEventListener("click", function () {
    var a = document.createElement("a"); a.href = vid.src; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    say("Downloading. Upload it as a Reel, a TikTok and a YouTube Short.");
  });
})();

/* Profile kit: copy buttons for the bios. */
(function () {
  "use strict";
  document.querySelectorAll(".profile .pcopy").forEach(function (b) {
    b.addEventListener("click", function () {
      var t = b.parentNode.previousElementSibling, msg = b.closest(".profile").querySelector(".msg");
      var done = function () { msg.textContent = "Copied."; };
      if (navigator.clipboard) navigator.clipboard.writeText(t.value).then(done, function () { t.select(); document.execCommand("copy"); done(); });
      else { t.select(); document.execCommand("copy"); done(); }
    });
  });
})();
