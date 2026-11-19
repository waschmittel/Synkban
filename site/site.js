(() => {
  const THEME_KEY = "synkban-site-theme";

  // Theme toggle
  const applyTheme = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      const dark = theme === "dark";
      btn.setAttribute("aria-pressed", String(dark));
      btn.title = dark ? "Switch to light mode" : "Switch to dark mode";
    }
  };

  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === "dark" || savedTheme === "light") {
    applyTheme(savedTheme);
  } else {
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }

  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.classList.add("theme-switching");
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.documentElement.classList.remove("theme-switching")),
    );
  });

  // Mobile nav drawer
  const navBurger = document.getElementById("nav-burger");
  const navLinks = document.getElementById("nav-links");
  navBurger?.addEventListener("click", () => {
    const open = navLinks?.classList.toggle("open");
    navBurger.setAttribute("aria-expanded", String(!!open));
  });
  navLinks?.addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      navLinks.classList.remove("open");
      navBurger?.setAttribute("aria-expanded", "false");
    }
  });

  // Hero showcase tabs
  const heroTabs = [...document.querySelectorAll(".showcase-tabs .tab-btn")];
  const heroPanels = [...document.querySelectorAll(".showcase-panel")];
  const selectHeroTab = (idx) => {
    heroTabs.forEach((t, i) => {
      const active = i === idx;
      t.setAttribute("aria-selected", String(active));
      t.tabIndex = active ? 0 : -1;
    });
    heroPanels.forEach((p, i) => p.classList.toggle("active", i === idx));
  };
  heroTabs.forEach((tab, idx) => {
    tab.addEventListener("click", () => selectHeroTab(idx));
    tab.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const next = (idx + (e.key === "ArrowRight" ? 1 : -1) + heroTabs.length) % heroTabs.length;
        selectHeroTab(next);
        heroTabs[next].focus();
      }
    });
  });

  // OS Install tabs
  const osTabs = [...document.querySelectorAll(".os-tab")];
  const osPanels = [...document.querySelectorAll(".os-panel")];
  const selectOs = (os) => {
    osTabs.forEach((t) => {
      const active = t.dataset.os === os;
      t.setAttribute("aria-selected", String(active));
    });
    osPanels.forEach((p) => p.classList.toggle("active", p.dataset.os === os));
  };
  if (osTabs.length) {
    const ua = navigator.userAgent.toLowerCase();
    const detected = ua.includes("win") ? "windows" : ua.includes("linux") ? "linux" : "macos";
    selectOs(detected);
    osTabs.forEach((t) => t.addEventListener("click", () => selectOs(t.dataset.os)));
  }

  // Copy buttons on code blocks
  document.querySelectorAll(".code-copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.parentElement?.querySelector("pre")?.innerText?.trimEnd() ?? "";
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = "Copied";
      } catch {
        btn.textContent = "Failed";
      }
      setTimeout(() => {
        btn.textContent = "Copy";
      }, 1500);
    });
  });

  // Click-to-zoom screenshot lightbox
  const zoomables = [...document.querySelectorAll("[data-zoom]")];
  if (zoomables.length) {
    const lb = document.createElement("div");
    lb.className = "lightbox";
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-modal", "true");
    lb.setAttribute("aria-label", "Screenshot preview");
    lb.innerHTML =
      '<button type="button" class="lightbox-close" aria-label="Close preview">&times;</button>' +
      '<div class="lightbox-inner"><img alt=""><div class="lightbox-cap"></div></div>';
    document.body.appendChild(lb);

    const lbImg = lb.querySelector("img");
    const lbCap = lb.querySelector(".lightbox-cap");
    const lbClose = lb.querySelector(".lightbox-close");
    let prevFocus = null;

    const closeLb = () => {
      lb.classList.remove("open");
      if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus();
      prevFocus = null;
    };

    const openLb = (img) => {
      prevFocus = document.activeElement;
      lbImg.src = img.currentSrc || img.src;
      lbImg.alt = img.alt || "";
      lbCap.textContent = img.dataset.caption || img.alt || "";
      lb.classList.add("open");
      lbClose.focus();
    };

    zoomables.forEach((img) => img.addEventListener("click", () => openLb(img)));
    lbClose.addEventListener("click", closeLb);
    lb.addEventListener("click", (e) => {
      if (e.target === lb) closeLb();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && lb.classList.contains("open")) closeLb();
    });
  }

  // Docs sidebar: filter, scroll-spy, mobile drawer
  const toc = document.getElementById("toc-list");
  if (toc) {
    const links = [...toc.querySelectorAll("a")];
    const heads = links.map((a) => document.getElementById(a.getAttribute("href").slice(1)));
    let current = null;

    const spy = () => {
      const y = 104;
      let idx = -1;
      for (let i = 0; i < heads.length; i++) {
        if (heads[i] && heads[i].getBoundingClientRect().top <= y) idx = i;
      }
      if (idx < 0) idx = 0;
      if (links[idx] && links[idx] !== current) {
        current?.classList.remove("active");
        current = links[idx];
        current.classList.add("active");
      }
    };
    window.addEventListener("scroll", spy, { passive: true });
    spy();

    const filter = document.getElementById("toc-filter");
    filter?.addEventListener("input", () => {
      const q = filter.value.trim().toLowerCase();
      for (const li of toc.children) {
        const own = li.querySelector(":scope > a")?.textContent.toLowerCase().includes(q) ?? false;
        const kids = [...li.querySelectorAll("ul a")];
        let anyKid = false;
        for (const k of kids) {
          const match = k.textContent.toLowerCase().includes(q);
          k.parentElement.classList.toggle("hide", !!q && !own && !match);
          if (match) anyKid = true;
        }
        li.classList.toggle("hide", !!q && !own && !anyKid);
      }
    });

    const side = document.getElementById("docs-side");
    const tocBtn = document.getElementById("mobile-toc-btn");
    tocBtn?.addEventListener("click", () => {
      const open = side?.classList.toggle("open");
      tocBtn.setAttribute("aria-expanded", String(!!open));
    });
    toc.addEventListener("click", () => {
      side?.classList.remove("open");
      tocBtn?.setAttribute("aria-expanded", "false");
    });
  }
})();
