/**
 * LiqKit runtime — vanilla JS behavior layer for LiqKit components.
 * Replicates shadcn/ui (Radix) behaviors: portals, escape-to-close, focus
 * management, scroll lock, and data-state driven animations.
 * No dependencies, ~6kb minified. Load once in theme.liquid.
 */
(function () {
  "use strict";

  /* ---------- helpers ---------- */

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  /* Escape to close the top-most overlay (dialog/menu) */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var open = $$("[data-liqkit-overlay][data-state='open']");
    if (!open.length) return;
    var top = open[open.length - 1];
    closeOverlay(top);
    // Return focus to the trigger
    var trigger = document.querySelector(
      '[data-liqkit-trigger-for="' + top.id + '"]'
    );
    if (trigger) trigger.focus();
  });

  /* Click outside closes the top-most overlay */
  document.addEventListener("pointerdown", function (e) {
    var open = $$("[data-liqkit-overlay][data-state='open']");
    if (!open.length) return;
    var top = open[open.length - 1];
    if (!top.contains(e.target)) closeOverlay(top);
  });

  function closeOverlay(el) {
    el.setAttribute("data-state", "closing");
    el.classList.add("liqkit-out");
    setTimeout(function () {
      el.setAttribute("data-state", "closed");
      el.classList.remove("liqkit-out");
      el.hidden = true;
      document.body.classList.remove("liqkit-scroll-lock");
    }, 150);
  }

  function openOverlay(el) {
    document.body.classList.add("liqkit-scroll-lock");
    el.hidden = false;
    el.setAttribute("data-state", "open");
    var focusTarget = $("[data-liqkit-autofocus]", el) || el;
    focusTarget.focus();
  }

  /* ---------- dialog / modal ---------- */

  document.addEventListener("click", function (e) {
    var trigger = e.target.closest("[data-liqkit-dialog-trigger]");
    if (!trigger) return;
    var id = trigger.getAttribute("data-liqkit-dialog-trigger");
    var dialog = document.getElementById(id);
    if (!dialog) return;
    e.preventDefault();
    openOverlay(dialog);
  });

  /* close buttons inside dialogs */
  document.addEventListener("click", function (e) {
    var closeBtn = e.target.closest("[data-liqkit-close]");
    if (!closeBtn) return;
    var overlay = closeBtn.closest("[data-liqkit-overlay]");
    if (overlay) closeOverlay(overlay);
  });

  /* ---------- dropdown menu ---------- */

  document.addEventListener("click", function (e) {
    var trigger = e.target.closest("[data-liqkit-menu-trigger]");
    if (!trigger) return;
    var id = trigger.getAttribute("data-liqkit-menu-trigger");
    var menu = document.getElementById(id);
    if (!menu) return;

    var isOpen = menu.getAttribute("data-state") === "open";
    // close any open menus first
    $$("[data-liqkit-overlay][data-state='open']").forEach(function (m) {
      if (m !== menu) closeOverlay(m);
    });
    if (isOpen) {
      closeOverlay(menu);
    } else {
      // position menu relative to trigger
      var rect = trigger.getBoundingClientRect();
      menu.style.position = "fixed";
      var align = trigger.getAttribute("data-liqkit-align") || "end";
      if (align === "end") {
        menu.style.right = window.innerWidth - rect.right + "px";
      } else {
        menu.style.left = rect.left + "px";
      }
      menu.style.top = rect.bottom + 4 + "px";
      openOverlay(menu);
    }
    e.preventDefault();
    e.stopPropagation();
  });

  /* menu items */
  document.addEventListener("click", function (e) {
    var item = e.target.closest("[data-liqkit-menu-item]");
    if (!item) return;
    var menu = item.closest("[data-liqkit-overlay]");
    if (menu) closeOverlay(menu);
  });

  /* ---------- accordion ---------- */

  document.addEventListener("click", function (e) {
    var trigger = e.target.closest("[data-liqkit-accordion-trigger]");
    if (!trigger) return;
    var item = trigger.closest("[data-liqkit-accordion-item]");
    if (!item) return;
    var content = $("[data-liqkit-accordion-content]", item);
    if (!content) return;
    var isOpen = item.getAttribute("data-state") === "open";
    // single-open behavior (like shadcn default)
    var root = item.closest("[data-liqkit-accordion]");
    if (root) {
      $$("[data-liqkit-accordion-item][data-state='open']", root).forEach(
        function (other) {
          if (other !== item) {
            other.setAttribute("data-state", "closed");
            var c = $("[data-liqkit-accordion-content]", other);
            if (c) {
              c.style.height = "0px";
              c.setAttribute("aria-hidden", "true");
            }
          }
        }
      );
    }
    if (isOpen) {
      item.setAttribute("data-state", "closed");
      content.style.height = "0px";
      content.setAttribute("aria-hidden", "true");
    } else {
      item.setAttribute("data-state", "open");
      content.style.height = content.scrollHeight + "px";
      content.setAttribute("aria-hidden", "false");
    }
  });

  /* ---------- tabs ---------- */

  function activateTab(tabEl) {
    var root = tabEl.closest("[data-liqkit-tabs]");
    if (!root) return;
    var id = tabEl.getAttribute("data-liqkit-tab-trigger");
    $$("[data-liqkit-tab-trigger]", root).forEach(function (t) {
      var active = t === tabEl;
      t.setAttribute("data-state", active ? "active" : "inactive");
      t.setAttribute("aria-selected", active ? "true" : "false");
      t.tabIndex = active ? 0 : -1;
    });
    $$("[data-liqkit-tab-panel]", root).forEach(function (p) {
      var active = p.id === id;
      p.hidden = !active;
      if (active) {
        p.setAttribute("data-state", "active");
      } else {
        p.setAttribute("data-state", "inactive");
      }
    });
  }

  document.addEventListener("click", function (e) {
    var tab = e.target.closest("[data-liqkit-tab-trigger]");
    if (tab) activateTab(tab);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    var active = $("[data-liqkit-tab-trigger][data-state='active']");
    if (!active) return;
    var root = active.closest("[data-liqkit-tabs]");
    if (!root) return;
    var tabs = $$("[data-liqkit-tab-trigger]", root);
    var idx = tabs.indexOf(active);
    var next =
      e.key === "ArrowRight"
        ? (idx + 1) % tabs.length
        : (idx - 1 + tabs.length) % tabs.length;
    e.preventDefault();
    tabs[next].focus();
    activateTab(tabs[next]);
  });

  /* ---------- switch ---------- */

  document.addEventListener("click", function (e) {
    var sw = e.target.closest("[data-liqkit-switch]");
    if (!sw) return;
    var checked = sw.getAttribute("data-state") === "checked";
    sw.setAttribute("data-state", checked ? "unchecked" : "checked");
    sw.setAttribute("aria-checked", checked ? "false" : "true");
    var input = $("input", sw);
    if (input) input.checked = !checked;
  });

  /* init: set default states, fix heights */
  document.addEventListener("DOMContentLoaded", function () {
    $$("[data-liqkit-accordion-item][data-state='open']").forEach(function (
      item
    ) {
      var c = $("[data-liqkit-accordion-content]", item);
      if (c) c.style.height = c.scrollHeight + "px";
    });
  });

  /* expose */
  window.LiqKit = {
    open: openOverlay,
    close: closeOverlay,
    activateTab: activateTab,
  };
})();
