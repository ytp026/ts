(function () {
  "use strict";

  const MAX_LABEL_LENGTH = 120;

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function compactLabel(element) {
    const explicit = element.dataset.analyticsLabel
      || element.getAttribute("aria-label")
      || element.getAttribute("title")
      || element.innerText
      || element.textContent;
    return cleanText(explicit || element.id || element.className || element.tagName)
      .slice(0, MAX_LABEL_LENGTH);
  }

  function sectionName(element) {
    const section = element.closest("section[id], main[id], article[id]");
    return section ? section.id : "page";
  }

  function eventType(element) {
    if (element.matches('[role="tab"], [aria-selected], .tab, .tab-button')) return "tab";
    if (element.closest('a[href*="#"]')) {
      const link = element.closest('a[href*="#"]');
      if (link) {
        const href = link.getAttribute("href");
        const target = href && href.split("#")[1];
        if (target && link.pathname === window.location.pathname) return "section_link";
      }
    }
    if (element.matches("a[href]")) return "link";
    if (element.matches("button, [role='button'], [data-action], summary")) return "button";
    return "control";
  }

  function hrefLabel(element) {
    if (!element.matches("a[href]")) return "";
    const href = element.getAttribute("href");
    if (!href) return "";
    if (href.startsWith("#")) return href.slice(1);
    try {
      const url = new URL(href, window.location.href);
      return `${url.pathname}${url.hash}`;
    } catch {
      return "";
    }
  }

  function sendAnalytics(element) {
    const type = eventType(element);
    const label = compactLabel(element);
    const section = sectionName(element);
    const target = hrefLabel(element);
    const eventName = `${type}_click`;
    const details = {
      interaction_type: type,
      interaction_label: label,
      interaction_section: section,
      page_title: document.title
    };
    if (target) details.interaction_target = target;

    if (typeof window.gtag === "function") {
      window.gtag("event", eventName, details);
    }
    if (typeof window.clarity === "function") {
      window.clarity("event", eventName);
      window.clarity("set", "last_click_type", type);
      window.clarity("set", "last_click_label", label);
      window.clarity("set", "last_click_section", section);
    }
  }

  document.addEventListener("click", (event) => {
    const element = event.target.closest(
      'button, a[href], [role="button"], [role="tab"], [aria-controls], [data-action], summary'
    );
    if (!element || element.disabled) return;
    sendAnalytics(element);
  }, true);
})();
