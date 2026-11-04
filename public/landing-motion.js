/** Product motion on the landing: one hero run, card and step sequences on first view.
 *  Content is fully rendered without this script; motion only starts from that state. */
(function () {
  const root = document.querySelector(".agentsos-home");
  if (!root || !("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  /** Reveal a <pre> line by line with clip-path; returns { duration, cancel } */
  function revealLines(pre, { stepMs = 140, pauseBefore = null, pauseMs = 0 } = {}) {
    const code = pre.querySelector("code") || pre;
    const lineHeight = parseFloat(getComputedStyle(code).lineHeight);
    const height = pre.getBoundingClientRect().height;
    if (!lineHeight || !height) return { duration: 0, cancel() {} };

    const lines = Math.max(1, Math.round(height / lineHeight));
    const pauseEl = pauseBefore ? pre.querySelector(pauseBefore) : null;
    const pauseLine = pauseEl
      ? Math.round((pauseEl.getBoundingClientRect().top - pre.getBoundingClientRect().top) / lineHeight)
      : -1;

    const timers = [];
    let at = 0;
    let arriveAt = 0;
    const clipTo = (shown) => {
      pre.style.clipPath = `inset(0 0 ${Math.max(0, height - shown * lineHeight)}px 0)`;
    };

    clipTo(0);
    for (let i = 1; i <= lines; i += 1) {
      at += stepMs + (i - 1 === pauseLine ? pauseMs : 0);
      if (i - 1 === pauseLine) arriveAt = at;
      timers.push(setTimeout(() => (i === lines ? pre.style.removeProperty("clip-path") : clipTo(i)), at));
    }
    if (pauseEl) pre.style.setProperty("--motion-arrive-delay", `${arriveAt}ms`);
    pre.classList.add("is-revealing");

    return {
      duration: at,
      cancel() {
        timers.forEach(clearTimeout);
        pre.style.removeProperty("clip-path");
        pre.classList.remove("is-revealing");
      },
    };
  }

  function onFirstView(elements, callback, options) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        callback(entry.target);
      });
    }, options);
    elements.forEach((el) => io.observe(el));
  }

  /** Hero: run Inbox → Your app → Result once; any user input on the tabs stops it */
  function initHeroRun() {
    const demo = root.querySelector(".hero-code-demo");
    const tabs = demo ? Array.from(demo.querySelectorAll('[role="tab"]')) : [];
    if (tabs.length < 2) return;

    let timer = 0;
    let reveal = null;
    let done = false;

    const stop = () => {
      done = true;
      clearTimeout(timer);
      reveal?.cancel();
      demo.classList.remove("is-autoplay");
    };

    const play = (index) => {
      if (done) return;
      const tab = tabs[index];
      // Programmatic click reuses the tab logic in site-shell.js (aria-selected, tabindex, hidden)
      if (tab.getAttribute("aria-selected") !== "true") tab.click();

      const pre = document.getElementById(tab.getAttribute("aria-controls"))?.querySelector("pre");
      reveal?.cancel();
      reveal = pre ? revealLines(pre, { stepMs: 150, pauseBefore: ".code-ok", pauseMs: 520 }) : null;

      if (index === tabs.length - 1) {
        demo.classList.remove("is-autoplay");
        done = true;
        return;
      }

      const dwell = (reveal?.duration ?? 0) + 1500;
      demo.style.setProperty("--hero-step-ms", `${dwell}ms`);
      demo.classList.add("is-autoplay");
      timer = setTimeout(() => play(index + 1), dwell);
    };

    const tablist = demo.querySelector('[role="tablist"]');
    tablist.addEventListener("pointerdown", stop);
    tablist.addEventListener("keydown", stop);
    tablist.addEventListener("click", (event) => {
      if (event.isTrusted) stop();
    });

    onFirstView([demo], () => {
      timer = setTimeout(() => play(0), 250);
    }, { threshold: 0.4 });
  }

  initHeroRun();

  onFirstView(root.querySelectorAll(".agent-catalog-card .agent-visual"), (visual) => {
    visual.classList.add("is-playing");
  }, { threshold: 0.35, rootMargin: "0px 0px -8% 0px" });

  onFirstView(root.querySelectorAll(".agentsos-workflow .landing-steps"), (steps) => {
    steps.classList.add("is-playing");
  }, { threshold: 0.3, rootMargin: "0px 0px -8% 0px" });

  onFirstView(root.querySelectorAll(".mail-spotlight-code pre"), (pre) => {
    revealLines(pre, { stepMs: 90, pauseBefore: ".t-cm", pauseMs: 600 });
  }, { threshold: 0.45 });
})();
