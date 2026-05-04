/* ============================================================
   main.js — Wyre Website
   ============================================================ */

(function () {
  'use strict';

  /* ── Theme Toggle ─────────────────────────────────────── */
  const html      = document.documentElement;
  const themeBtn  = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');

  function getStoredTheme() {
    return localStorage.getItem('wyre-theme') || 'dark';
  }

  function applyTheme(theme) {
    html.setAttribute('data-theme', theme);
    localStorage.setItem('wyre-theme', theme);
    if (themeIcon) {
      themeIcon.className = theme === 'dark'
        ? 'fa-solid fa-sun'
        : 'fa-solid fa-moon';
    }
  }

  applyTheme(getStoredTheme());

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = html.getAttribute('data-theme');
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  /* ── Nav scroll effect ────────────────────────────────── */
  const nav = document.getElementById('nav');

  function updateNav() {
    if (!nav) return;
    if (window.scrollY > 20) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav();

  /* ── Mobile hamburger ─────────────────────────────────── */
  const hamburger  = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.toggle('open');
      hamburger.classList.toggle('open', isOpen);
      hamburger.setAttribute('aria-expanded', String(isOpen));
    });

    mobileMenu.querySelectorAll('.nav__mobile-link').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });

    // Also close when the Download button inside mobile menu is clicked
    const mobileDownload = mobileMenu.querySelector('.btn--primary');
    if (mobileDownload) {
      mobileDownload.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    }
  }

  /* ── Smooth scroll for anchor links ──────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const navHeight = nav ? nav.offsetHeight : 64;
        const top = target.getBoundingClientRect().top + window.scrollY - navHeight - 16;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  /* ── Scroll reveal ────────────────────────────────────── */
  const revealEls = document.querySelectorAll(
    '.feature-card, .step, .platform-card, .download-card:not(#macosTrigger), .section-header, .privacy__content, .privacy__visual'
  );

  revealEls.forEach(el => el.classList.add('reveal'));

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const siblings = Array.from(entry.target.parentElement.children);
          const idx = siblings.indexOf(entry.target);
          entry.target.style.transitionDelay = `${idx * 0.07}s`;
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  revealEls.forEach(el => observer.observe(el));

  /* ── macOS dropdown ───────────────────────────────────── */
  const macosTrigger  = document.getElementById('macosTrigger');
  const macosDropdown = document.getElementById('macosDropdown');

  function openMacosDropdown() {
    macosDropdown.classList.add('open');
    macosTrigger.classList.add('open');
    macosTrigger.setAttribute('aria-expanded', 'true');
  }

  function closeMacosDropdown() {
    macosDropdown.classList.remove('open');
    macosTrigger.classList.remove('open');
    macosTrigger.setAttribute('aria-expanded', 'false');
  }

  if (macosTrigger && macosDropdown) {

    macosTrigger.addEventListener('click', function (e) {
      e.stopPropagation();
      macosDropdown.classList.contains('open') ? closeMacosDropdown() : openMacosDropdown();
    });

    macosTrigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        macosDropdown.classList.contains('open') ? closeMacosDropdown() : openMacosDropdown();
      }
    });

    document.addEventListener('click', function (e) {
      if (
        !macosTrigger.contains(e.target) &&
        !macosDropdown.contains(e.target)
      ) {
        closeMacosDropdown();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMacosDropdown();
    });
  }

  /* ── Windows dropdown ─────────────────────────────────── */
  const windowsTrigger  = document.getElementById('windowsTrigger');
  const windowsDropdown = document.getElementById('windowsDropdown');

  function openWindowsDropdown() {
    windowsDropdown.classList.add('open');
    windowsTrigger.classList.add('open');
    windowsTrigger.setAttribute('aria-expanded', 'true');
  }

  function closeWindowsDropdown() {
    windowsDropdown.classList.remove('open');
    windowsTrigger.classList.remove('open');
    windowsTrigger.setAttribute('aria-expanded', 'false');
  }

  if (windowsTrigger && windowsDropdown) {

    windowsTrigger.addEventListener('click', function (e) {
      e.stopPropagation();
      windowsDropdown.classList.contains('open') ? closeWindowsDropdown() : openWindowsDropdown();
    });

    windowsTrigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        windowsDropdown.classList.contains('open') ? closeWindowsDropdown() : openWindowsDropdown();
      }
    });

    document.addEventListener('click', function (e) {
      if (
        !windowsTrigger.contains(e.target) &&
        !windowsDropdown.contains(e.target)
      ) {
        closeWindowsDropdown();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeWindowsDropdown();
    });
  }

  /* ── Mockup device selection animation ───────────────── */
  const mockupDevices = document.querySelectorAll('.mockup-device');
  let currentSelected = 0;

  function cycleMockupSelection() {
    mockupDevices.forEach((d, i) => {
      d.classList.toggle('mockup-device--selected', i === currentSelected);
    });
    currentSelected = (currentSelected + 1) % mockupDevices.length;
  }

  if (mockupDevices.length) {
    setInterval(cycleMockupSelection, 2200);
  }

  /* ── Animated transfer progress bar ──────────────────── */
  const progressFill = document.querySelector('.mockup-transfer__fill');
  const progressPct  = document.querySelector('.mockup-transfer__pct');

  if (progressFill && progressPct) {
    let pct = 72;
    let direction = 1;

    setInterval(() => {
      pct += direction * (Math.random() * 3 + 0.5);
      if (pct >= 100) {
        pct = 100;
        direction = -1;
        setTimeout(() => { pct = 5; direction = 1; }, 1200);
      }
      if (pct <= 5) { direction = 1; }
      progressFill.style.width = Math.min(100, Math.max(0, pct)).toFixed(0) + '%';
      progressPct.textContent  = Math.min(100, Math.max(0, pct)).toFixed(0) + '%';
    }, 300);
  }

  /* ── Active nav link highlight on scroll ─────────────── */
  const sections = document.querySelectorAll('section[id]');
  const navLinks  = document.querySelectorAll('.nav__link');

  function updateActiveLink() {
    let current = '';
    const scrollBottom = window.scrollY + window.innerHeight;
    const pageHeight   = document.documentElement.scrollHeight;

    // If within 40px of the page bottom, force the last section active
    if (scrollBottom >= pageHeight - 40) {
      const lastSection = sections[sections.length - 1];
      if (lastSection) current = lastSection.id;
    } else {
      sections.forEach(section => {
        if (window.scrollY >= section.offsetTop - 120) current = section.id;
      });
    }

    navLinks.forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === '#' + current);
      link.style.color = '';
    });
  }

  window.addEventListener('scroll', updateActiveLink, { passive: true });
  updateActiveLink();

})();
