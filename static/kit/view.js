/* Shows one post-kit card centred at full window height (#india-1). */
document.getElementById("c").src = "/kit/" + location.hash.slice(1).replace(/[^a-z0-9-]/g, "") + ".jpg";
window.addEventListener("hashchange", function () { location.reload(); });
