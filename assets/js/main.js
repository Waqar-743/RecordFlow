(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $ (sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$ (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function initReveal () {
    var items = $$("[data-reveal]");
    if (reduceMotion || !("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  }

  function initActiveNav () {
    var links = $$(".nav__link");
    var map = {};
    links.forEach(function (l) {
      var href = l.getAttribute("href") || "";
      if (href.charAt(0) === "#") map[href.slice(1)] = l;
    });
    var ids = Object.keys(map);
    if (!ids.length || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var id = entry.target.id;
        var link = map[id];
        if (!link) return;
        if (entry.isIntersecting) {
          links.forEach(function (l) { l.classList.remove("is-active"); });
          link.classList.add("is-active");
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }

  function initMenu () {
    var toggle = $(".nav__toggle");
    var menu = $("#mobile-menu");
    if (!toggle || !menu) return;
    var close = $(".menu__close", menu);
    var links = $$(".menu__link", menu);

    function open () {
      menu.classList.add("is-open");
      document.body.style.overflow = "hidden";
      toggle.setAttribute("aria-expanded", "true");
    }
    function closeMenu () {
      menu.classList.remove("is-open");
      document.body.style.overflow = "";
      toggle.setAttribute("aria-expanded", "false");
    }
    toggle.addEventListener("click", function () {
      menu.classList.contains("is-open") ? closeMenu() : open();
    });
    if (close) close.addEventListener("click", closeMenu);
    links.forEach(function (l) { l.addEventListener("click", closeMenu); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.classList.contains("is-open")) closeMenu();
    });
  }

  function initFaq () {
    var items = $$(".faq__item");
    items.forEach(function (item) {
      var q = $(".faq__q", item);
      if (!q) return;
      q.addEventListener("click", function () {
        var wasOpen = item.classList.contains("is-open");
        items.forEach(function (other) {
          other.classList.remove("is-open");
          var bq = $(".faq__q", other);
          if (bq) bq.setAttribute("aria-expanded", "false");
        });
        if (!wasOpen) {
          item.classList.add("is-open");
          q.setAttribute("aria-expanded", "true");
        }
      });
    });
  }

  function initMagnetic () {
    if (reduceMotion || window.matchMedia("(pointer: coarse)").matches) return;
    var btns = $$("[data-magnetic]");
    btns.forEach(function (btn) {
      btn.addEventListener("pointermove", function (e) {
        var r = btn.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) / r.width;
        var y = (e.clientY - r.top - r.height / 2) / r.height;
        btn.style.transform = "translate(" + (x * 4).toFixed(1) + "px, " + (y * 3).toFixed(1) + "px)";
      });
      btn.addEventListener("pointerleave", function () {
        btn.style.transform = "";
      });
    });
  }

  function initYear () {
    var el = $$("[data-year]");
    el.forEach(function (n) { n.textContent = new Date().getFullYear(); });
  }

  function initSmoothAnchors () {
    $$('a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        var id = a.getAttribute("href");
        if (id.length < 2) return;
        var target = document.getElementById(id.slice(1));
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initReveal();
    initActiveNav();
    initMenu();
    initFaq();
    initMagnetic();
    initYear();
    initSmoothAnchors();
  });
})();
