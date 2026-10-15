/* Sends contribution forms to /api/submit without leaving the page. Without JavaScript the form still posts normally. */
(function () {
  "use strict";
  document.querySelectorAll("form.contribute").forEach(function (form) {
    var msg = form.querySelector(".form-msg");
    var btn = form.querySelector("button[type=submit]");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      msg.hidden = true; msg.className = "form-msg";
      btn.disabled = true; btn.textContent = "Sending…";
      var body = new URLSearchParams(new FormData(form));
      fetch(form.action, { method: "POST", body: body, headers: { "Accept": "application/json" }, credentials: "omit", referrerPolicy: "no-referrer" })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          msg.hidden = false;
          if (res.ok) {
            msg.classList.add("ok");
            msg.textContent = res.j.message || "Received. Thank you. A person will review it before anything is published.";
            form.reset();
          } else {
            msg.classList.add("err");
            msg.textContent = res.j.error || "That didn't go through. Check the fields and try again.";
          }
        })
        .catch(function () {
          msg.hidden = false; msg.classList.add("err");
          msg.textContent = "We couldn't reach the server. Check your connection and try again.";
        })
        .finally(function () { btn.disabled = false; btn.textContent = form.getAttribute("data-label"); });
    });
  });
})();
