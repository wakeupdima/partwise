/* Partwise landing — interactions (no framework). */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- smooth scroll for in-page links (prototype connections) ---------- */
  function scrollToEl(el, focusEl) {
    if (!el) return;
    el.scrollIntoView({ behavior: reduce.matches ? "auto" : "smooth", block: "start" });
    if (focusEl) {
      // focus after the scroll settles, without a second jump
      setTimeout(function () { focusEl.focus({ preventScroll: true }); }, reduce.matches ? 0 : 550);
    }
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-scroll]");
    if (!a) return;
    var id = a.getAttribute("href");
    if (!id || id.charAt(0) !== "#") return;
    var target = id === "#top" ? document.body : document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    if (target.tagName === "DETAILS") target.open = true;
    var f = a.getAttribute("data-focus");
    scrollToEl(id === "#top" ? $("#top") : target, f ? document.getElementById(f) : null);
    history.replaceState(null, "", id === "#top" ? location.pathname : id);
  });

  /* ---------- current section in nav ---------- */
  var navLinks = $$(".nav__links a");
  if ("IntersectionObserver" in window) {
    var map = {};
    navLinks.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var a = map[en.target.id];
        if (a && en.isIntersecting) {
          navLinks.forEach(function (x) { x.removeAttribute("aria-current"); });
          a.setAttribute("aria-current", "true");
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    Object.keys(map).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
  }

  /* ---------- hero scales down on narrower screens (design is a 1440 composition) ---------- */
  var hero = $(".hero"), stage = $(".hero__stage");
  function fitHero() {
    // ≤760 px: mobile hero composition (390 × 1010, Figma 309:2837); otherwise the 1440 × 980 desktop one
    var w = document.documentElement.clientWidth, mobile = w <= 760;
    var s = Math.min(1, w / (mobile ? 390 : 1440));
    stage.style.setProperty("--hero-scale", s);
    hero.style.height = ((mobile ? 1010 : 980) * s) + "px";
    var how = $(".how__stage");
    if (how) how.style.setProperty("--how-scale", Math.min(1, how.clientWidth / 788));
  }
  window.addEventListener("resize", fitHero);
  fitHero();

  /* ---------- pause looping illustrations off-screen ---------- */
  if ("IntersectionObserver" in window) {
    var vis = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.target.classList.toggle("is-offscreen", !e.isIntersecting); });
    }, { rootMargin: "200px 0px" });
    $$(".hero__illus, .card__stage, .how__stage").forEach(function (el) { vis.observe(el); });
  }

  /* ---------- enquiry form ---------- */
  var form = $("#enquiry-form");
  var part = $("#part"), qty = $("#qty"), email = $("#email");
  var partList = $("#part-list"), partsBox = $("#parts");
  var partErr = $("#part-error"), qtyErr = $("#qty-error"), emailErr = $("#email-error");
  var partHelper = $("#part-helper");
  var submit = $("#submit"), submitLabel = $(".form__submit-label");
  var success = $("#success"), status = $("#form-status");
  var listMode = false;

  // MPN: letters/digits groups joined by - . / and containing a digit, e.g. SPBW06F-12, DDR-60G-24
  var MPN = /^(?=.*\d)[A-Z0-9]{2,}(?:[-./][A-Z0-9]+)+$/i;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function setError(input, el, msg) {
    if (msg) { el.textContent = msg; el.hidden = false; input.setAttribute("aria-invalid", "true"); }
    else { el.textContent = ""; el.hidden = true; input.removeAttribute("aria-invalid"); }
  }
  function partValues() {
    if (listMode) return partList.value.split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    return $$("input", partsBox).map(function (i) { return i.value.trim(); }).filter(Boolean);
  }
  function validatePart() {
    var vals = partValues();
    var input = listMode ? partList : part;
    if (!vals.length) { setError(input, partErr, "Enter a part number. Example: SPBW06F-12."); return false; }
    var bad = vals.filter(function (v) { return !MPN.test(v); });
    if (bad.length) { setError(input, partErr, "Check the part number" + (vals.length > 1 ? " (" + bad.join(", ") + ")" : "") + ". Example: SPBW06F-12."); return false; }
    setError(input, partErr, ""); return true;
  }
  function validateQty() {
    var v = qty.value.replace(/\s/g, "");
    if (!v) { setError(qty, qtyErr, "Enter a quantity."); return false; }
    if (!/^\d+$/.test(v) || +v < 1) { setError(qty, qtyErr, "Enter a whole number of units, e.g. 140."); return false; }
    setError(qty, qtyErr, ""); return true;
  }
  function validateEmail() {
    var v = email.value.trim();
    if (!v) { setError(email, emailErr, "Enter your email."); return false; }
    if (!EMAIL.test(v)) { setError(email, emailErr, "Check the email. Example: you@company.com."); return false; }
    setError(email, emailErr, ""); return true;
  }
  // Inline errors appear after submit or on leaving a field (as on board 276:5497)
  var touched = {};
  [[part, validatePart], [partList, validatePart], [qty, validateQty], [email, validateEmail]].forEach(function (p) {
    p[0].addEventListener("blur", function () { if (p[0].value.trim()) { touched[p[0].id] = true; p[1](); } });
    p[0].addEventListener("input", function () { if (touched[p[0].id] || p[0].getAttribute("aria-invalid")) p[1](); });
  });
  part.addEventListener("input", function () { if (partHelper.dataset.mpn && part.value.trim().toUpperCase() !== partHelper.dataset.mpn) { partHelper.hidden = true; } });

  $("#add-part").addEventListener("click", function () {
    if (listMode) $("#paste-list").click();
    var n = $$("input", partsBox).length + 1;
    var i = document.createElement("input");
    i.className = "input"; i.type = "text"; i.name = "part-" + n; i.autocomplete = "off"; i.spellcheck = false;
    i.placeholder = "e.g. SPBW06G-05"; i.setAttribute("aria-label", "Part number " + n);
    i.addEventListener("input", function () { if (part.getAttribute("aria-invalid")) validatePart(); });
    partsBox.appendChild(i); i.focus();
  });
  $("#paste-list").addEventListener("click", function () {
    // compute values from inputs before switching
    if (!listMode) { var vals = $$("input", partsBox).map(function (i) { return i.value.trim(); }).filter(Boolean); partList.value = vals.join("\n"); }
    listMode = !listMode;
    partsBox.hidden = listMode; partList.hidden = !listMode;
    this.textContent = listMode ? "Enter one by one" : "Paste a list";
    if (!listMode) { var v = partList.value.split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean); part.value = v[0] || ""; }
    (listMode ? partList : part).focus();
    setError(part, partErr, ""); partList.removeAttribute("aria-invalid");
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    touched.part = touched.qty = touched.email = true;
    var ok = [validatePart(), validateQty(), validateEmail()];
    if (ok.indexOf(false) !== -1) {
      var first = [listMode ? partList : part, qty, email][ok.indexOf(false)];
      first.focus();
      status.textContent = "Please correct the highlighted fields.";
      return;
    }
    // Sending (simulated — no backend)
    submit.disabled = true; submit.setAttribute("aria-busy", "true");
    submitLabel.textContent = "Sending…";
    status.textContent = "Sending your enquiry…";
    var parts = partValues().map(function (s) { return s.toUpperCase(); });
    var q = qty.value.replace(/\s/g, ""), mail = email.value.trim();
    setTimeout(function () {
      form.hidden = true;
      $("#success-summary").innerHTML = "";
      $("#success-summary").append(parts.join(", ") + " · " + q + " pcs", document.createElement("br"), mail);
      $("#success-text").textContent = "A manager will reply to " + mail + " within one business day with price, lead time and supply terms.";
      success.hidden = false;
      success.focus();
      status.textContent = "Enquiry sent.";
      submit.disabled = false; submit.removeAttribute("aria-busy"); submitLabel.textContent = "Request price and lead time";
    }, 1200);
  });

  $("#send-another").addEventListener("click", function () {
    var keepEmail = email.value;
    form.reset(); email.value = keepEmail;
    $$("input", partsBox).slice(1).forEach(function (i) { i.remove(); });
    if (listMode) $("#paste-list").click();
    partHelper.hidden = true; touched = {};
    [[part, partErr], [qty, qtyErr], [email, emailErr]].forEach(function (p) { setError(p[0], p[1], ""); });
    success.hidden = true; form.hidden = false;
    part.focus();
  });

  /* ---------- "Request price" on a card → pre-fill the part number, focus Quantity ---------- */
  $$("[data-request]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var card = btn.closest(".card");
      if (!success.hidden) $("#send-another").click();
      if (listMode) $("#paste-list").click();
      var mpn = card.dataset.mpn;
      part.value = mpn; setError(part, partErr, "");
      partHelper.textContent = "Selected in catalogue · " + card.dataset.in + " in, " + card.dataset.out + " out";
      partHelper.dataset.mpn = mpn; partHelper.hidden = false;
      scrollToEl($("#enquiry"), qty);
    });
  });

  /* ---------- Quick request under the hero → carry number and quantity to the form ---------- */
  $("#quick-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var qp = $("#q-part").value.trim(), qq = $("#q-qty").value.trim();
    if (!success.hidden) $("#send-another").click();
    if (listMode) $("#paste-list").click();
    if (qp) { part.value = qp; validatePart(); touched.part = true; }
    if (qq) { qty.value = qq; validateQty(); touched.qty = true; }
    partHelper.hidden = true;
    var next = !qp || !MPN.test(qp) ? part : (!qq || !/^\d+$/.test(qq.replace(/\s/g, "")) ? qty : email);
    scrollToEl($("#enquiry"), next);
  });
})();
