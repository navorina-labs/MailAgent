/**
 * Shared nav (thirdweb-style dropdowns), docs sidebar, and footer.
 */
(function () {
  const GITHUB = "https://github.com/navorina-labs/AgentsOS";
  const PORTFOLIO = "https://alexyoung33rd.com/";
  const CONTACT = "hello@webmailagent.com";
  const KEY_REQUEST = "/get-key.html";
  const LOGO_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><text x="12" y="12.5" text-anchor="middle" dominant-baseline="middle" fill="#ecfef5" font-family="Georgia, 'Times New Roman', Times, serif" font-size="16" font-weight="500">a</text></svg>`;

  const NAV_DROPDOWNS = [
    {
      id: "product",
      label: "Product",
      items: [
        { href: "/#agents", label: "Agent catalog", desc: "Mail, context, design, marketing, and safety" },
        { href: "/dashboard.html", label: "Mail Agent", desc: "Production email and QA agent" },
        { href: "/#features", label: "Features", desc: "OTP, magic links, safe CTAs" },
        { href: "/#qa", label: "QA / Playwright", desc: "Isolated inboxes per CI worker" },
        { href: "/#workspace", label: "Workspace Agent", desc: "Summarize, draft, policy-gated send" },
        { href: "/#mcp", label: "MCP tools", desc: "49 agent tools for QA and mail" },
        { href: "/dashboard.html", label: "Dashboard", desc: "Plan, inboxes, keys, billing" },
        { href: "/workspace.html", label: "Workspace", desc: "Gmail triage, rules, monitors, drafts" },
      ],
    },
    {
      id: "developers",
      label: "Developers",
      items: [
        { href: "/docs/", label: "API reference", desc: "REST endpoints and schemas" },
        { href: "/docs/agents.html", label: "AI agents", desc: "Cursor, Codex, remote MCP" },
        { href: "/docs/integrate.html", label: "Self-host", desc: "Deploy on Cloudflare Workers" },
        { href: "https://api.webmailagent.com/v1/openapi.json", label: "OpenAPI", desc: "Machine-readable spec", external: true },
      ],
    },
    {
      id: "resources",
      label: "Resources",
      items: [
        { href: "/docs/qa.html", label: "QA guide", desc: "Playwright, labels, simulate" },
        { href: "/docs/autotests.html", label: "Autotests", desc: "Contract tests without SMTP" },
        { href: "/docs/agent-skills.html", label: "Agent Skills", desc: "Install mailagent skill" },
        { href: "/status.html", label: "Status", desc: "Hosted API availability" },
      ],
    },
  ];

  /** App sidebar nav — Resend / Vercel pattern (Mobbin refs). */
  const CONSOLE_ITEMS = [
    {
      id: "dashboard",
      href: "/dashboard.html",
      label: "Overview",
      icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>`,
    },
    {
      id: "workspace",
      href: "/workspace.html",
      label: "Workspace",
      icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 4.5h11v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7Z"/><path d="M2.5 4.5 8 8.5l5.5-4"/></svg>`,
    },
    {
      id: "audit",
      href: "/audit.html",
      label: "Logs",
      icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 3h10v10H3z"/><path d="M5.5 6.5h5M5.5 9h5"/></svg>`,
    },
    {
      id: "debug",
      href: "/debug.html",
      label: "Debug",
      icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6.5 3.5 3 7l3.5 3.5M9.5 3.5 13 7l-3.5 3.5"/></svg>`,
    },
    {
      id: "agent-runs",
      href: "/agent-runs.html",
      label: "Runs",
      icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 3.5v9M4 8h6.5l-2.5-2.5L10.5 8l-2.5 2.5"/></svg>`,
    },
  ];

  /** Docs sidebar: guides + entry points into console (not full tool list). */
  const DOC_SECTIONS = [
    {
      title: "Start",
      items: [
        { id: "api", href: "/docs/", label: "API reference" },
        { id: "integrate", href: "/docs/integrate.html", label: "Self-host" },
      ],
    },
    {
      title: "Console",
      items: [
        { id: "dashboard", href: "/dashboard.html", label: "Dashboard" },
        { id: "workspace", href: "/workspace.html", label: "Workspace" },
      ],
    },
    {
      title: "Guides",
      items: [
        { id: "agents", href: "/docs/agents.html", label: "AI agents" },
        { id: "agent-skills", href: "/docs/agent-skills.html", label: "Agent Skills" },
        { id: "autotests", href: "/docs/autotests.html", label: "Autotests" },
        { id: "codex", href: "/docs/codex.html", label: "OpenAI Codex" },
        { id: "oauth-idp", href: "/docs/oauth-idp.html", label: "MCP OAuth (IdP)" },
        { id: "teams", href: "/docs/teams.html", label: "Teams & keys" },
        { id: "qa", href: "/docs/qa.html", label: "QA / Playwright" },
        { id: "scoped-keys", href: "/docs/scoped-keys.html", label: "Scoped keys" },
        { id: "raw-mime", href: "/docs/raw-mime.html", label: "Raw MIME" },
        { id: "attachments", href: "/docs/attachments.html", label: "Attachments" },
        { id: "custom-domain", href: "/docs/custom-domain.html", label: "Custom domain" },
        { id: "dedicated-domains", href: "/docs/dedicated-domains.html", label: "Dedicated Resend" },
        { id: "outbound", href: "/docs/outbound.html", label: "Outbound send" },
        { id: "billing", href: "/docs/billing.html", label: "Billing" },
        { id: "enterprise", href: "/docs/enterprise.html", label: "Enterprise" },
        { id: "sla", href: "/docs/sla.html", label: "SLA (draft)" },
        { id: "security", href: "/docs/security.html", label: "Security" },
        { id: "qa-troubleshoot", href: "/docs/qa-troubleshooting.html", label: "Troubleshooting" },
      ],
    },
  ];

  const body = document.body;
  const mode = body.dataset.site || "marketing";
  const docId = body.dataset.doc || "";
  const path = location.pathname.replace(/\/$/, "") || "/";
  const primaryMain = document.querySelector("main");

  if (primaryMain) {
    if (!primaryMain.id) primaryMain.id = "main-content";
    if (!primaryMain.hasAttribute("tabindex")) primaryMain.setAttribute("tabindex", "-1");
    if (!document.querySelector(".skip-link")) {
      body.insertAdjacentHTML(
        "afterbegin",
        `<a class="skip-link" href="#${primaryMain.id}">Skip to main content</a>`,
      );
    }
  }

  function isActive(href) {
    const h = href.replace(/\/$/, "") || "/";
    const pathNorm = path.replace(/\.html$/, "");
    const hNorm = h.replace(/\.html$/, "");
    if (hNorm === "/docs" && (pathNorm === "/docs" || path.endsWith("/docs/index.html"))) return true;
    return path === h || path.endsWith(h) || pathNorm === hNorm;
  }

  function navLink(href, label) {
    const cur = isActive(href);
    return `<a href="${href}"${cur ? ' aria-current="page"' : ""}>${label}</a>`;
  }

  function renderDropdown(group) {
    const items = group.items
      .map((item) => {
        const ext = item.external ? ' target="_blank" rel="noopener noreferrer"' : "";
        return `<a class="nav-dropdown-item" href="${item.href}"${ext} role="menuitem"><strong>${item.label}</strong><span>${item.desc}</span></a>`;
      })
      .join("");
    return `<div class="nav-dropdown" data-dropdown="${group.id}">
      <button type="button" class="nav-dropdown-trigger" aria-expanded="false" aria-haspopup="true" aria-controls="nav-panel-${group.id}">
        ${group.label}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="nav-dropdown-panel" id="nav-panel-${group.id}" role="menu">${items}</div>
    </div>`;
  }

  function renderAppSidebarLink(item) {
    const cur = docId === item.id || isActive(item.href);
    return `<a href="${item.href}" class="dash-nav__link${cur ? " is-active" : ""}"${cur ? ' aria-current="page"' : ""}>
      <span class="dash-nav__icon">${item.icon}</span>
      <span>${item.label}</span>
    </a>`;
  }

  function renderAppInsightsRail() {
    return `<aside class="dash-rail" id="dash-insights-rail" aria-label="Usage overview">
      <div id="dash-insights"></div>
    </aside>`;
  }

  function renderAppNav() {
    const links = CONSOLE_ITEMS.map(renderAppSidebarLink).join("");
    return `<aside class="dash-sidebar" id="site-header">
      <div class="dash-sidebar__nav-island">
        <div class="dash-sidebar__brand">
          <a href="/dashboard.html" class="dash-sidebar__logo">
            <span class="logo-mark">${LOGO_SVG}</span>
            <span>MailAgent</span>
          </a>
        </div>
        <nav class="dash-nav" aria-label="Console">${links}</nav>
      </div>
      <div class="dash-sidebar__foot">
        <div id="app-session-slot"></div>
        <div class="dash-sidebar__links">
          <a href="/docs/">Documentation</a>
          <a href="${GITHUB}" rel="noopener noreferrer">GitHub</a>
        </div>
      </div>
    </aside>`;
  }

  function renderNavLinks() {
    if (mode === "marketing") {
      return `${navLink("/#how", "How it works")}
        ${navLink("/#integrations", "Integrations")}
        ${navLink("/#compare", "Compare")}
        ${navLink("/#pricing", "Pricing")}
        ${navLink("/docs/", "Docs")}`;
    }
    return `${navLink("/docs/", "Docs")}
      ${navLink("/docs/integrate.html", "Self-host")}
      ${navLink("/docs/agents.html", "Agents")}
      ${navLink("/dashboard.html", "Dashboard")}
      ${navLink("/workspace.html", "Workspace")}`;
  }

  function renderNav() {
    if (mode === "app") return renderAppNav();

    const navCtas = mode === "marketing"
      ? `<a class="btn btn-sm btn-primary btn-nav-console" href="${KEY_REQUEST}" data-analytics-event="mailagent_key_requested" data-analytics-surface="navigation">Get API key</a>`
      : `<a class="btn btn-sm btn-primary btn-nav-console" href="/dashboard.html">Open Mail Agent</a>`;
    const links = renderNavLinks();
    const brandName = mode === "marketing" ? "Mail Agent" : "MailAgent";

    return `<header class="nav" id="site-header">
      <div class="nav-inner site-container">
        <div class="nav-start">
          <a href="/" class="logo">
            <span class="logo-mark">${LOGO_SVG}</span>
            ${brandName}
          </a>
        </div>
        <nav class="nav-links" id="nav-links" aria-label="Primary">${links}</nav>
        <div class="nav-end">
          <div class="nav-actions">
            <a class="btn btn-sm btn-ghost nav-github" href="${GITHUB}" rel="noopener noreferrer">GitHub</a>
            ${navCtas}
          </div>
          <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="nav-links" id="nav-toggle">
            <span class="sr-only">Menu</span>
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
          </button>
        </div>
        <div class="nav-mobile-actions" id="nav-mobile-actions">
          <a class="btn btn-sm btn-ghost" href="${GITHUB}" rel="noopener noreferrer">GitHub</a>
          ${navCtas}
        </div>
      </div>
    </header>`;
  }

  function renderSidebarLinks(items, linkClass) {
    return items
      .map((item) => {
        const cur = docId === item.id || isActive(item.href);
        const cls = [linkClass, cur ? "is-active" : ""].filter(Boolean).join(" ");
        return `<li><a href="${item.href}"${cls ? ` class="${cls}"` : ""}${cur ? ' aria-current="page"' : ""}>${item.label}</a></li>`;
      })
      .join("");
  }

  function renderSidebarSection(title, items) {
    return `<div class="doc-sidebar-group"><p class="doc-sidebar-title">${title}</p><ul>${renderSidebarLinks(items, "")}</ul></div>`;
  }

  function renderDocSidebar() {
    return DOC_SECTIONS.map((section) => renderSidebarSection(section.title, section.items)).join("");
  }

  function renderAppFooter() {
    return "";
  }

  /** Full landing footer — single source for all pages. */
  function renderFooterInner() {
    return `<div class="footer-inner">
        <div class="footer-col">
          <h4>Mail Agent</h4>
          <ul>
            <li><a href="/#how">How it works</a></li>
            <li><a href="/#integrations">Integrations</a></li>
            <li><a href="/#compare">Compare</a></li>
            <li><a href="/#pricing">Pricing</a></li>
            <li><a href="/#faq">FAQ</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4>Developers</h4>
          <ul>
            <li><a href="/docs/">API reference</a></li>
            <li><a href="/docs/agents.html">MCP and AI agents</a></li>
            <li><a href="/docs/qa.html">Playwright and Cypress</a></li>
            <li><a href="/docs/autotests.html">Autotests</a></li>
            <li><a href="/docs/integrate.html">Self-host</a></li>
            <li><a href="https://api.webmailagent.com/v1/openapi.json" rel="noopener noreferrer">OpenAPI</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4>Console</h4>
          <ul>
            <li><a href="/dashboard.html">Hosted console</a></li>
            <li><a href="/status.html">Service status</a></li>
            <li><a href="/docs/security.html">Security</a></li>
            <li><a href="mailto:${CONTACT}">${CONTACT}</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4>Project</h4>
          <ul>
            <li><a href="${GITHUB}" rel="noopener noreferrer">AgentsOS on GitHub</a></li>
            <li><a href="${GITHUB}/tree/main/agents/mail-agent" rel="noopener noreferrer">Mail Agent source</a></li>
            <li><a href="${GITHUB}/blob/main/LICENSE" rel="noopener noreferrer">MIT License</a></li>
            <li><a href="/privacy.html">Privacy</a></li>
            <li><a href="/terms.html">Terms</a></li>
          </ul>
        </div>
      </div>`;
  }

  function renderFooterLegal() {
    return `<div class="footer-legal">
        <p class="footer-legal-copy">
          © Mail Agent, part of AgentsOS
        </p>
        <p class="footer-legal-copy">
          Made by
          <a href="${PORTFOLIO}" target="_blank" rel="noopener noreferrer">Alexander Young</a>
        </p>
      </div>`;
  }

  function renderFooterWordmark() {
    return `<a href="/" class="footer-wordmark-link" aria-label="Mail Agent home">
        <span class="footer-wordmark" id="footerWordmark">Mail Agent</span>
      </a>`;
  }

  function renderFooter() {
    return `<footer class="footer">
      <div class="site-container">
        ${renderFooterInner()}
        ${renderFooterLegal()}
        ${renderFooterWordmark()}
      </div>
    </footer>`;
  }

  /** Wordmark: split letters + in-view gradient reveal. */
  function initFooterWordmark() {
    const footer = document.querySelector(".footer");
    const logo = footer?.querySelector("#footerWordmark");
    if (!logo || logo.dataset.split === "1") return;

    const text = (logo.textContent || "").trim();
    if (!text) return;
    logo.dataset.split = "1";
    logo.textContent = "";
    logo.setAttribute("aria-hidden", "true");
    logo.style.setProperty("--char-count", String(text.length));
    for (let i = 0; i < text.length; i++) {
      const ch = document.createElement("span");
      ch.className = "footer-wordmark-char";
      ch.textContent = text.charAt(i);
      ch.style.setProperty("--char-i", String(i));
      logo.appendChild(ch);
    }

    const link = footer.querySelector(".footer-wordmark-link");

    function bindInview() {
      if (logo.classList.contains("is-inview")) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        logo.classList.add("is-inview");
        return;
      }
      const target = link || logo;
      if (typeof IntersectionObserver === "undefined") {
        logo.classList.add("is-inview");
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              logo.classList.add("is-inview");
              observer.disconnect();
            }
          });
        },
        { threshold: 0.08, rootMargin: "0px" }
      );
      observer.observe(target);
    }

    bindInview();
    const fit = () => fitFooterWordmarkWidth(logo, link);
    requestAnimationFrame(fit);
    if (document.fonts?.ready) {
      document.fonts.ready.then(fit).catch(() => {});
    }

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => fitFooterWordmarkWidth(logo, link), 120);
    });
  }

  /** Увеличивает font-size wordmark до ширины контейнера, без разрыва между буквами. */
  function fitFooterWordmarkWidth(logo, link) {
    if (!logo || !link) return;
    logo.style.fontSize = "";
    const avail = link.clientWidth;
    const width = logo.scrollWidth;
    if (!avail || !width || width >= avail) return;
    const base = parseFloat(getComputedStyle(logo).fontSize);
    if (!Number.isFinite(base) || base <= 0) return;
    logo.style.fontSize = `${base * (avail / width) * 0.985}px`;
  }

  /** WAI-ARIA menu button: keyboard nav, focus return, Escape. */
  function initNavDropdowns() {
    const header = document.getElementById("site-header");
    const dropdowns = header?.querySelectorAll(".nav-dropdown") ?? [];
    if (!header) return;

    const desktop = () => window.matchMedia("(min-width: 900px)").matches;
    let keyboardOpened = null;

    function menuItems(dropdown) {
      return [...dropdown.querySelectorAll(".nav-dropdown-item")];
    }

    function closeDropdown(dropdown, restoreFocus) {
      if (!dropdown) return;
      dropdown.classList.remove("is-open");
      const trigger = dropdown.querySelector(".nav-dropdown-trigger");
      trigger?.setAttribute("aria-expanded", "false");
      if (restoreFocus && keyboardOpened === dropdown) {
        trigger?.focus();
        keyboardOpened = null;
      }
    }

    function closeAll(except, restoreFocus) {
      dropdowns.forEach((dropdown) => {
        if (dropdown === except) return;
        closeDropdown(dropdown, restoreFocus);
      });
    }

    function openDropdown(dropdown, { focusItem, fromKeyboard }) {
      closeAll(dropdown, false);
      dropdown.classList.add("is-open");
      const trigger = dropdown.querySelector(".nav-dropdown-trigger");
      trigger?.setAttribute("aria-expanded", "true");
      if (fromKeyboard) keyboardOpened = dropdown;
      const items = menuItems(dropdown);
      if (focusItem && items.length) items[0].focus();
    }

    function focusMenuItem(items, current, delta) {
      if (!items.length) return;
      const idx = items.indexOf(current);
      const next = items[(idx + delta + items.length) % items.length];
      next?.focus();
    }

    dropdowns.forEach((dropdown) => {
      const trigger = dropdown.querySelector(".nav-dropdown-trigger");
      const panel = dropdown.querySelector(".nav-dropdown-panel");
      if (!trigger || !panel) return;

      trigger.addEventListener("click", (event) => {
        const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
        if (finePointer && desktop()) return;
        event.preventDefault();
        event.stopPropagation();
        const open = !dropdown.classList.contains("is-open");
        if (open) openDropdown(dropdown, { focusItem: true, fromKeyboard: true });
        else closeDropdown(dropdown, true);
      });

      trigger.addEventListener("keydown", (event) => {
        const items = menuItems(dropdown);
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDropdown(dropdown, { focusItem: true, fromKeyboard: true });
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          openDropdown(dropdown, { focusItem: false, fromKeyboard: true });
          if (items.length) items[items.length - 1].focus();
        }
      });

      panel.addEventListener("keydown", (event) => {
        const panelItems = menuItems(dropdown);
        const current = document.activeElement;
        switch (event.key) {
          case "ArrowDown":
            event.preventDefault();
            focusMenuItem(panelItems, current, 1);
            break;
          case "ArrowUp":
            event.preventDefault();
            focusMenuItem(panelItems, current, -1);
            break;
          case "Home":
            event.preventDefault();
            panelItems[0]?.focus();
            break;
          case "End":
            event.preventDefault();
            panelItems[panelItems.length - 1]?.focus();
            break;
          case "Escape":
            event.preventDefault();
            closeDropdown(dropdown, true);
            break;
          case "Tab":
            closeDropdown(dropdown, false);
            break;
          default:
            break;
        }
      });

      menuItems(dropdown).forEach((item) => {
        item.setAttribute("tabindex", "-1");
      });
    });

    document.addEventListener("click", (event) => {
      if (event.target.closest(".nav-dropdown")) return;
      closeAll(null, true);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const mobileMenuWasOpen = header?.classList.contains("is-open");
      dropdowns.forEach((dropdown) => closeDropdown(dropdown, true));
      header?.classList.remove("is-open");
      const navToggle = document.getElementById("nav-toggle");
      navToggle?.setAttribute("aria-expanded", "false");
      if (mobileMenuWasOpen) navToggle?.focus();
    });
  }

  function initNavScroll() {
    const header = document.getElementById("site-header");
    if (!header) return;

    const sync = () => {
      header.classList.toggle("is-scrolled", window.scrollY > 12);
    };

    sync();
    window.addEventListener("scroll", sync, { passive: true });
  }

  function initHeroCodeTabs() {
    const tablist = document.querySelector(".hero-code-tabs");
    if (!tablist) return;

    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    const activate = (nextTab, { focus = false } = {}) => {
      tabs.forEach((tab) => {
        const selected = tab === nextTab;
        tab.setAttribute("aria-selected", selected ? "true" : "false");
        tab.setAttribute("tabindex", selected ? "0" : "-1");
        const panel = document.getElementById(tab.getAttribute("aria-controls"));
        if (!panel) return;
        panel.hidden = !selected;
        panel.classList.toggle("is-active", selected);
      });
      if (focus) nextTab.focus();
    };

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activate(tab));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = tabs.length - 1;
        activate(tabs[nextIndex], { focus: true });
      });
    });
  }

  const navMount = document.getElementById("site-nav");
  if (navMount) {
    navMount.outerHTML = renderNav();
    if (mode === "app") {
      const sidebar = document.getElementById("site-header");
      const main = document.querySelector(".dash-main");
      if (sidebar && main && !document.querySelector(".dash-app")) {
        const shell = document.createElement("div");
        shell.className = "dash-app";
        sidebar.parentNode.insertBefore(shell, sidebar);
        shell.appendChild(sidebar);

        const frame = document.createElement("div");
        frame.className = "dash-frame";
        frame.appendChild(main);
        frame.insertAdjacentHTML("beforeend", renderAppInsightsRail());
        shell.appendChild(frame);
      }
    } else {
      initNavDropdowns();
      initNavScroll();
    }
    const header = document.getElementById("site-header");
    const toggle = document.getElementById("nav-toggle");
    const links = document.getElementById("nav-links");
    if (toggle && links && header) {
      toggle.addEventListener("click", () => {
        const open = header.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });

      header.addEventListener("click", (event) => {
        if (!event.target.closest("a") || !header.classList.contains("is-open")) return;
        header.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    }
  }

  initHeroCodeTabs();

  const sideMount = document.getElementById("site-doc-nav");
  if (sideMount && mode === "docs") {
    sideMount.innerHTML = renderDocSidebar();
  }

  const footMount = document.getElementById("site-footer");
  if (footMount) {
    footMount.outerHTML = mode === "app" ? renderAppFooter() : renderFooter();
    if (mode !== "app") initFooterWordmark();
  }
})();
