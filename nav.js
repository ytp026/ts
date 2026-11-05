"use strict";

window.SiteNav = {
  closeGroups(nav, except) {
    nav.querySelectorAll(".nav-group.open").forEach((group) => {
      if (group === except) return;
      group.classList.remove("open");
      group.querySelector(".nav-trigger")?.setAttribute("aria-expanded", "false");
    });
  },

  setMenu(nav, open) {
    nav.classList.toggle("open", open);
    const toggle = nav.querySelector(".nav-toggle");
    toggle?.setAttribute("aria-expanded", String(open));
    toggle?.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  },

  init(doc) {
    const nav = doc.querySelector(".navigation");
    if (!nav || !nav.querySelector(".nav-menu")) return null;
    nav.classList.add("js-nav");
    const current = nav.querySelector(".nav-dropdown a[aria-current='page']");
    const currentGroup = current?.closest(".nav-group");
    if (currentGroup && window.matchMedia("(max-width: 1180px)").matches) {
      currentGroup.classList.add("open");
      currentGroup.querySelector(".nav-trigger")?.setAttribute("aria-expanded", "true");
    }

    nav.querySelector(".nav-toggle")?.addEventListener("click", () => {
      this.setMenu(nav, !nav.classList.contains("open"));
    });

    nav.querySelectorAll(".nav-trigger").forEach((trigger) => {
      trigger.addEventListener("click", () => {
        const group = trigger.closest(".nav-group");
        const open = !group.classList.contains("open");
        this.closeGroups(nav, group);
        group.classList.toggle("open", open);
        trigger.setAttribute("aria-expanded", String(open));
      });
    });

    doc.addEventListener("click", (event) => {
      if (!nav.contains(event.target)) {
        this.closeGroups(nav);
        this.setMenu(nav, false);
      }
    });

    doc.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const openGroup = nav.querySelector(".nav-group.open");
      this.closeGroups(nav);
      if (openGroup) openGroup.querySelector(".nav-trigger")?.focus();
      else if (nav.classList.contains("open")) {
        this.setMenu(nav, false);
        nav.querySelector(".nav-toggle")?.focus();
      }
    });
    return nav;
  },
};

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => window.SiteNav.init(document));
}
