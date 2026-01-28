/* /site.js*/
/* global gsap, ScrollTrigger */

(function () {
  "use strict";

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function createLoader() {
    var loader = document.createElement("div");
    loader.id = "vlp-loader";
    loader.setAttribute("aria-hidden", "true");
    loader.style.cssText = [
      "align-items:center",
      "background:#070a10",
      "display:flex",
      "flex-direction:column",
      "inset:0",
      "justify-content:center",
      "position:fixed",
      "z-index:9999"
    ].join(";");

    var logo = document.createElement("img");
    logo.alt = "";
    logo.decoding = "async";
    logo.fetchPriority = "high";
    logo.height = 60;
    logo.loading = "eager";
    logo.src = "/assets/Virtual-Launch-Pro_Logo_200x60_Black.svg";
    logo.style.cssText = "filter:invert(1);height:40px;width:auto";
    logo.width = 200;

    var bar = document.createElement("div");
    bar.style.cssText = [
      "background:rgba(255,255,255,0.12)",
      "border-radius:999px",
      "height:6px",
      "margin-top:18px",
      "overflow:hidden",
      "width:220px"
    ].join(";");

    var fill = document.createElement("div");
    fill.id = "vlp-loader-fill";
    fill.style.cssText = [
      "background:#f97316",
      "height:100%",
      "transform:translateX(-100%)",
      "width:100%"
    ].join(";");

    bar.appendChild(fill);
    loader.appendChild(logo);
    loader.appendChild(bar);
    document.body.appendChild(loader);
    return loader;
  }

  function fetchInclude(node) {
    var key = node.getAttribute("data-include");
    var url = "/partials/" + key + ".html";
    return fetch(url, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Include failed: " + url);
        return res.text();
      })
      .then(function (html) {
        node.innerHTML = html;
        return { key: key, node: node };
      });
  }

  function loadIncludes() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll("[data-include]"));
    if (!nodes.length) return Promise.resolve([]);
    return Promise.all(nodes.map(fetchInclude)).catch(function (err) {
      console.error(err);
      return [];
    });
  }

  function initArtifactsTabs() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-artifacts-tab]"));
    var panels = Array.prototype.slice.call(document.querySelectorAll("[data-artifacts-panel]"));
    if (!buttons.length || !panels.length) return;

    function setActive(key) {
      buttons.forEach(function (b) {
        var on = b.getAttribute("data-artifacts-tab") === key;
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.classList.toggle("artifact-tab--active", on);
        b.classList.toggle("bg-ink-950", on);
        b.classList.toggle("border-white/10", on);
        b.classList.toggle("shadow-soft", on);
        b.classList.toggle("text-white", on);
        b.classList.toggle("bg-transparent", !on);
        b.classList.toggle("border-transparent", !on);
        b.classList.toggle("text-white/75", !on);
      });

      panels.forEach(function (p) {
        var show = p.getAttribute("data-artifacts-panel") === key;
        p.classList.toggle("hidden", !show);
      });
    }

    buttons.forEach(function (b) {
      b.addEventListener("click", function () {
        setActive(b.getAttribute("data-artifacts-tab"));
      });
    });

    setActive("tax-monitor");
  }

  function initDashboardPreview(root) {
    var host = root || document.getElementById("dashboard-preview");
    if (!host) return;

    var panels = Array.prototype.slice.call(host.querySelectorAll("[data-preview]"));
    var tabs = Array.prototype.slice.call(host.querySelectorAll("[data-tab]"));
    if (!panels.length || !tabs.length) return;

    function setActive(key) {
      tabs.forEach(function (t) {
        var isActive = t.getAttribute("data-tab") === key;
        var dot = t.querySelector("span[aria-hidden='true']");

        t.setAttribute("aria-selected", isActive ? "true" : "false");

        t.classList.toggle("tab--active", isActive);
        t.classList.toggle("bg-ink-950", isActive);
        t.classList.toggle("border-b-0", isActive);
        t.classList.toggle("border-white/15", isActive);
        t.classList.toggle("font-extrabold", isActive);
        t.classList.toggle("shadow-soft", isActive);
        t.classList.toggle("text-white", isActive);

        t.classList.toggle("border-transparent", !isActive);
        t.classList.toggle("font-semibold", !isActive);
        t.classList.toggle("text-white/60", !isActive);

        if (dot) {
          dot.classList.toggle("bg-emerald-300", isActive);
          dot.classList.toggle("bg-white/35", !isActive);
        }
      });

      panels.forEach(function (p) {
        var isActive = p.getAttribute("data-preview") === key;
        p.classList.toggle("preview--hidden", !isActive);
      });
    }

    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        setActive(t.getAttribute("data-tab"));
      });
    });

    setActive((host.querySelector(".tab--active") || tabs[0]).getAttribute("data-tab"));
  }

  function initGsapAnimations() {
    if (prefersReducedMotion()) return;
    if (!window.gsap) return;

    if (window.ScrollTrigger) {
      gsap.registerPlugin(ScrollTrigger);
    }

    var hero = document.querySelector("main#top section");
    var header = document.querySelector("header");

    if (header) {
      gsap.from(header, { duration: 0.6, ease: "power2.out", opacity: 0, y: -14 });
    }

    if (hero) {
      var badge = hero.querySelector("p");
      var cta = hero.querySelector("a");
      var h1 = hero.querySelector("h1");

      gsap.from([badge, h1, cta].filter(Boolean), {
        duration: 0.8,
        ease: "power2.out",
        opacity: 0,
        stagger: 0.12,
        y: 16
      });
    }

    if (!window.ScrollTrigger) return;

    var revealGroups = Array.prototype.slice.call(
      document.querySelectorAll("article, details.group, section .shadow-soft")
    );

    revealGroups.forEach(function (el) {
      gsap.from(el, {
        duration: 0.7,
        ease: "power2.out",
        opacity: 0,
        scrollTrigger: {
          once: true,
          start: "top 85%",
          trigger: el
        },
        y: 18
      });
    });
  }

  function run() {
    // Loader intentionally disabled (no DOM injected, no overlay).
    var loader = null;

    function finish() {
      initArtifactsTabs();
      initDashboardPreview();

      var hasGsapNow = Boolean(window.gsap);

      if (loader && hasGsapNow) {
        gsap.timeline({ defaults: { ease: "power2.out" } })
          .to("#vlp-loader-fill", { duration: 0.55, x: "100%" })
          .to("#vlp-loader", { duration: 0.45, opacity: 0 }, "-=0.1")
          .set("#vlp-loader", { display: "none" })
          .add(initGsapAnimations, "-=0.15");
      } else {
        if (loader) loader.style.display = "none";
        initGsapAnimations();
      }
    }

    loadIncludes().then(function (results) {
      results.forEach(function (r) {
        if (r.key === "dashboard-preview") {
          var section = r.node.querySelector("#dashboard-preview") || r.node;
          initDashboardPreview(section);
        }
      });

      if (document.readyState === "complete") {
        finish();
      } else {
        window.addEventListener("load", finish, { once: true });
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
