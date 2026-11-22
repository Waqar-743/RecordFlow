(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  var toastTimer = null;
  function showToast(msg) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("is-visible");
    }, 2600);
  }

  /* ============ 1. MULTI-THEME ENGINE ============ */
  function initThemes() {
    var menu = $("#theme-menu");
    var btn = $("#theme-toggle-btn");
    var label = $("#current-theme-label");
    var opts = $$("[data-set-theme]");
    var metaTheme = $('meta[name="theme-color"]');
    var themeColors = {
      obsidian: "#0e0c0b",
      ember: "#130e0a",
      crimson: "#120a0d",
      copper: "#161310",
      ivory: "#f4efe6",
      alabaster: "#faf7f4"
    };

    function applyTheme(id, announce) {
      if (!themeColors[id]) id = "ivory";
      document.documentElement.setAttribute("data-theme", id);
      if (metaTheme) metaTheme.setAttribute("content", themeColors[id]);
      try { localStorage.setItem("rf-site-theme-v2", id); } catch (e) {}

      opts.forEach(function (opt) {
        var active = opt.getAttribute("data-set-theme") === id;
        opt.classList.toggle("is-active", active);
        opt.setAttribute("aria-checked", active ? "true" : "false");
        if (active && label) {
          label.textContent = opt.getAttribute("data-theme-name") || id;
        }
      });
      if (announce) showToast("Theme switched to " + (label ? label.textContent : id));
    }

    var saved = null;
    try { saved = localStorage.getItem("rf-site-theme-v2"); } catch (e) {}
    applyTheme(saved && themeColors[saved] ? saved : "ivory", false);

    if (btn && menu) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var open = menu.classList.toggle("is-open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
      document.addEventListener("click", function (e) {
        if (!menu.contains(e.target)) {
          menu.classList.remove("is-open");
          btn.setAttribute("aria-expanded", "false");
        }
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && menu.classList.contains("is-open")) {
          menu.classList.remove("is-open");
          btn.setAttribute("aria-expanded", "false");
          btn.focus();
        }
      });
    }

    opts.forEach(function (opt) {
      opt.addEventListener("click", function () {
        applyTheme(opt.getAttribute("data-set-theme"), true);
        if (menu) menu.classList.remove("is-open");
        if (btn) btn.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ============ 2. MOBILE NAVIGATION ============ */
  function initMobileMenu() {
    var openBtn = $("#mobile-menu-open");
    var closeBtn = $("#mobile-menu-close");
    var drawer = $("#mobile-menu");
    if (!openBtn || !drawer) return;

    function setOpen(state) {
      drawer.classList.toggle("is-open", state);
      openBtn.setAttribute("aria-expanded", state ? "true" : "false");
      document.body.style.overflow = state ? "hidden" : "";
    }
    openBtn.addEventListener("click", function () { setOpen(true); });
    if (closeBtn) closeBtn.addEventListener("click", function () { setOpen(false); });
    $$(".mobile-menu__link", drawer).forEach(function (link) {
      link.addEventListener("click", function () { setOpen(false); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && drawer.classList.contains("is-open")) setOpen(false);
    });
  }

  /* ============ 3. INTERACTIVE RECORDFLOW STUDIO ============ */
  function initStudio() {
    var workspaceTabs = $$("[data-workspace]");
    var views = $$("[data-view]");
    var statusPill = $("#studio-status-pill");
    var statusText = $("#studio-status-text");

    function switchWorkspace(name) {
      workspaceTabs.forEach(function (tab) {
        var on = tab.getAttribute("data-workspace") === name;
        tab.classList.toggle("is-active", on);
        tab.setAttribute("aria-selected", on ? "true" : "false");
      });
      views.forEach(function (v) {
        v.classList.toggle("is-active", v.getAttribute("data-view") === name);
      });
      if (statusText && !isRecording) {
        statusText.textContent = name === "edit" ? "Edit Studio · 60 Hz Track Loaded" : "Ready · 1920×1080";
      }
    }

    workspaceTabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        switchWorkspace(tab.getAttribute("data-workspace"));
      });
    });

    /* --- Record Mode --- */
    var recStage = $("#rec-stage");
    var recStageLabel = $("#rec-stage-label");
    var simWinTitle = $("#sim-win-title");
    var capBtns = $$("[data-cap-mode]");
    capBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var mode = btn.getAttribute("data-cap-mode");
        capBtns.forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        if (recStage) recStage.setAttribute("data-mode", mode);
        if (recStageLabel) {
          if (mode === "screen") recStageLabel.textContent = "Display 1 · 1920 × 1080 · 60 Hz";
          if (mode === "area") recStageLabel.textContent = "Custom Area · 1280 × 720 · Locked";
          if (mode === "window") recStageLabel.textContent = "Isolated Window · Only target captured";
        }
      });
    });

    $$("[data-pick-win]").forEach(function (item) {
      item.addEventListener("click", function () {
        $$("[data-pick-win]").forEach(function (w) { w.classList.remove("is-selected"); });
        item.classList.add("is-selected");
        var picked = item.getAttribute("data-pick-win");
        if (simWinTitle) simWinTitle.textContent = picked;
        if (recStageLabel) recStageLabel.textContent = "Window · " + picked;
        showToast("Target window locked: " + picked.split(" (")[0]);
      });
    });

    /* Switches & VU meter */
    var micSwitch = $("#toggle-mic");
    var vuMeter = $("#vu-meter");
    var micMeta = $("#mic-meta");
    var micEnabled = true;

    function toggleSwitch(el, onChange) {
      if (!el) return;
      el.addEventListener("click", function () {
        var next = el.getAttribute("aria-checked") !== "true";
        el.setAttribute("aria-checked", next ? "true" : "false");
        if (onChange) onChange(next);
      });
    }

    toggleSwitch(micSwitch, function (on) {
      micEnabled = on;
      if (vuMeter) vuMeter.classList.toggle("is-active", on);
      if (micMeta) micMeta.textContent = on ? "48 kHz · Live Web Audio VU" : "Microphone muted";
    });

    if (vuMeter && !reduceMotion) {
      var bars = $$("span", vuMeter);
      setInterval(function () {
        bars.forEach(function (bar, i) {
          if (!micEnabled) {
            bar.style.height = "4px";
            return;
          }
          var wave = Math.sin(Date.now() / 180 + i * 0.65) * 0.5 + 0.5;
          var h = Math.round(4 + (wave * 0.65 + Math.random() * 0.35) * 14);
          bar.style.height = h + "px";
        });
      }, 150);
    }

    var camSwitch = $("#toggle-cam");
    var recCamMini = $("#rec-cam-mini");
    var camMeta = $("#cam-meta");
    toggleSwitch(camSwitch, function (on) {
      if (recCamMini) recCamMini.classList.toggle("is-hidden", !on);
      if (camMeta) camMeta.textContent = on ? "Independent .cam.mp4 · Editable later" : "Camera track disabled";
    });

    var sysSwitch = $("#toggle-sysaudio");
    toggleSwitch(sysSwitch, function (on) {
      showToast(on ? "WASAPI system audio enabled" : "WASAPI system audio muted");
    });

    var hideSwitch = $("#toggle-hideapp");
    var invisTag = $("#rec-invis-tag");
    toggleSwitch(hideSwitch, function (on) {
      if (invisTag) invisTag.textContent = on ? "WDA_EXCLUDEFROMCAPTURE · Active" : "App stays visible on desktop (excluded from shot)";
    });

    var countdownSecs = 3;
    $$("[data-countdown]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $$("[data-countdown]").forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        countdownSecs = parseInt(btn.getAttribute("data-countdown"), 10) || 0;
      });
    });

    /* Simulated Recording Flow */
    var recBtn = $("#sim-record-btn");
    var recLabel = $("#sim-record-label");
    var countdownOverlay = $("#countdown-overlay");
    var countdownNum = $("#countdown-num");
    var isRecording = false;
    var recInterval = null;
    var recSeconds = 0;

    function fmtTime(sec) {
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    }

    function beginRecording() {
      isRecording = true;
      recSeconds = 0;
      if (recBtn) recBtn.classList.add("is-recording");
      if (recLabel) recLabel.textContent = "Stop Recording (00:00)";
      if (statusPill) statusPill.classList.add("studio__pill--live");
      if (statusText) statusText.textContent = "REC · 00:00 · Invisible";

      recInterval = setInterval(function () {
        recSeconds += 1;
        var t = fmtTime(recSeconds);
        if (recLabel) recLabel.textContent = "Stop Recording (" + t + ")";
        if (statusText) statusText.textContent = "REC · " + t + " · Invisible";
      }, 1000);
    }

    function stopRecording() {
      isRecording = false;
      clearInterval(recInterval);
      if (recBtn) recBtn.classList.remove("is-recording");
      if (recLabel) recLabel.textContent = "Start Recording";
      if (statusPill) statusPill.classList.remove("studio__pill--live");
      switchWorkspace("edit");
      showToast("Recording saved locally — opened in Edit Studio!");
    }

    if (recBtn) {
      recBtn.addEventListener("click", function () {
        if (isRecording) {
          stopRecording();
          return;
        }
        if (countdownSecs > 0 && countdownOverlay && countdownNum) {
          var left = countdownSecs;
          countdownNum.textContent = String(left);
          countdownOverlay.classList.add("is-active");
          var cdTimer = setInterval(function () {
            left -= 1;
            if (left <= 0) {
              clearInterval(cdTimer);
              countdownOverlay.classList.remove("is-active");
              beginRecording();
            } else {
              countdownNum.textContent = String(left);
            }
          }, 700);
        } else {
          beginRecording();
        }
      });
    }

    /* --- Edit Studio Inspector --- */
    var inspTabs = $$("[data-insp]");
    var inspPanels = $$("[data-insp-panel]");
    inspTabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var target = tab.getAttribute("data-insp");
        inspTabs.forEach(function (t) {
          var on = t === tab;
          t.classList.toggle("is-active", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        inspPanels.forEach(function (p) {
          p.classList.toggle("is-active", p.getAttribute("data-insp-panel") === target);
        });
      });
    });

    var editCanvas = $("#edit-canvas");
    var editFootage = $("#edit-footage");
    var aspectVal = $("#aspect-val");

    $$("[data-aspect-btn]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var val = btn.getAttribute("data-aspect-btn");
        $$("[data-aspect-btn]").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        if (editCanvas) editCanvas.setAttribute("data-aspect", val);
        if (aspectVal) aspectVal.textContent = val;
      });
    });

    $$("[data-bg]").forEach(function (swatch) {
      swatch.addEventListener("click", function () {
        $$("[data-bg]").forEach(function (s) { s.classList.remove("is-active"); });
        swatch.classList.add("is-active");
        if (editCanvas) editCanvas.style.background = swatch.getAttribute("data-bg");
      });
    });

    var padRange = $("#range-padding");
    var padVal = $("#padding-val");
    if (padRange && editCanvas) {
      padRange.addEventListener("input", function () {
        editCanvas.style.padding = padRange.value + "px";
        if (padVal) padVal.textContent = padRange.value + "px";
      });
    }

    var radRange = $("#range-radius");
    var radVal = $("#radius-val");
    if (radRange && editFootage) {
      radRange.addEventListener("input", function () {
        editFootage.style.borderRadius = radRange.value + "px";
        if (radVal) radVal.textContent = radRange.value + "px";
      });
    }

    /* Independent Webcam Controls */
    var editCam = $("#edit-webcam");
    toggleSwitch($("#edit-cam-vis"), function (on) {
      if (editCam) editCam.classList.toggle("is-hidden", !on);
    });
    toggleSwitch($("#edit-cam-mirror"), function (on) {
      if (editCam) editCam.classList.toggle("is-mirrored", on);
    });
    $$("[data-cam-pos]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $$("[data-cam-pos]").forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        if (editCam) editCam.setAttribute("data-pos", btn.getAttribute("data-cam-pos"));
      });
    });
    $$("[data-cam-shape]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $$("[data-cam-shape]").forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        if (editCam) editCam.setAttribute("data-shape", btn.getAttribute("data-cam-shape"));
      });
    });
    var camSizeRange = $("#range-cam-size");
    var camSizeVal = $("#cam-size-val");
    if (camSizeRange && editCam) {
      camSizeRange.addEventListener("input", function () {
        var px = camSizeRange.value + "px";
        editCam.style.width = px;
        editCam.style.height = px;
        if (camSizeVal) camSizeVal.textContent = px;
      });
    }

    /* 60 Hz Auto-Zoom + Privacy Blur */
    var zoomScale = 1.42;
    var simCursor = $("#sim-cursor");
    var zoomResetTimer = null;

    $$("[data-zoom-level]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $$("[data-zoom-level]").forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        zoomScale = parseFloat(btn.getAttribute("data-zoom-level")) || 1.42;
      });
    });

    function triggerZoomAt(pctX, pctY) {
      if (!editFootage) return;
      var cx = Math.max(15, Math.min(85, pctX));
      var cy = Math.max(15, Math.min(85, pctY));
      if (simCursor) {
        simCursor.style.left = cx + "%";
        simCursor.style.top = cy + "%";
        simCursor.classList.remove("is-clicking");
        void simCursor.offsetWidth;
        simCursor.classList.add("is-clicking");
      }
      editFootage.style.transformOrigin = cx + "% " + cy + "%";
      editFootage.style.transform = "scale(" + zoomScale + ")";
      clearTimeout(zoomResetTimer);
      zoomResetTimer = setTimeout(function () {
        editFootage.style.transform = "scale(1)";
      }, 2100);
    }

    if (editCanvas) {
      editCanvas.addEventListener("click", function (e) {
        var r = editCanvas.getBoundingClientRect();
        var x = ((e.clientX - r.left) / r.width) * 100;
        var y = ((e.clientY - r.top) / r.height) * 100;
        triggerZoomAt(x, y);
      });
    }

    var trigBtn = $("#trigger-zoom-btn");
    if (trigBtn) {
      trigBtn.addEventListener("click", function () {
        triggerZoomAt(28, 72);
      });
    }
    var resetZoomBtn = $("#reset-zoom-btn");
    if (resetZoomBtn && editFootage) {
      resetZoomBtn.addEventListener("click", function () {
        clearTimeout(zoomResetTimer);
        editFootage.style.transform = "scale(1)";
      });
    }

    var blurBox = $("#edit-blur-box");
    toggleSwitch($("#edit-blur-toggle"), function (on) {
      if (blurBox) blurBox.classList.toggle("is-visible", on);
    });

    /* Interactive Timeline Playback */
    var playBtn = $("#timeline-play-btn");
    var playIcon = $("#play-icon");
    var playhead = $("#timeline-playhead");
    var timecode = $("#timeline-timecode");
    var track = $("#timeline-track");
    var playing = false;
    var playPct = 34;
    var playTimer = null;

    function updatePlayhead(pct) {
      playPct = Math.max(0, Math.min(100, pct));
      if (playhead) playhead.style.left = playPct + "%";
      if (track) track.setAttribute("aria-valuenow", String(Math.round(playPct)));
      if (timecode) {
        var cur = (playPct / 100) * 42;
        var m = Math.floor(cur / 60);
        var s = (cur % 60).toFixed(1).padStart(4, "0");
        timecode.textContent = "0" + m + ":" + s + " / 00:42.0";
      }
    }

    if (playBtn) {
      playBtn.addEventListener("click", function () {
        playing = !playing;
        if (playIcon) {
          playIcon.innerHTML = playing
            ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
            : '<polygon points="6,4 20,12 6,20"/>';
        }
        clearInterval(playTimer);
        if (playing) {
          playTimer = setInterval(function () {
            var next = playPct + 1.4;
            if (next >= 100) next = 0;
            updatePlayhead(next);
            if (Math.abs(next - 22) < 1.4 || Math.abs(next - 55) < 1.4) {
              triggerZoomAt(next < 40 ? 28 : 68, next < 40 ? 74 : 58);
            }
          }, 120);
        }
      });
    }

    if (track) {
      track.addEventListener("click", function (e) {
        var r = track.getBoundingClientRect();
        updatePlayhead(((e.clientX - r.left) / r.width) * 100);
      });
    }
  }

  /* ============ 4. LOCAL EXPORT MODAL SIMULATOR ============ */
  function initExportModal() {
    var modal = $("#export-modal");
    if (!modal) return;
    var openBtns = [$("#open-export-modal"), $("#open-export-modal-2")].filter(Boolean);
    var closeBtns = [$("#close-export-modal"), $("#cancel-export-btn")].filter(Boolean);
    var specSummary = $("#export-spec-summary");
    var estSize = $("#export-est-size");
    var runBtn = $("#run-export-sim");
    var progWrap = $("#export-progress");
    var progMsg = $("#export-progress-msg");
    var progPct = $("#export-progress-pct");
    var progFill = $("#export-progress-fill");

    var state = { format: "mp4", res: "1080p", fps: 60, qual: "high" };
    var resMap = { "4k": ["3840×2160", 3.1], "1440p": ["2560×1440", 1.75], "1080p": ["1920×1080", 1.0], "720p": ["1280×720", 0.55] };
    var qualMap = { best: ["Best", 1.45], high: ["High", 1.0], small: ["Small", 0.58] };
    var simTimer = null;

    function updateSummary() {
      var r = resMap[state.res];
      var q = qualMap[state.qual];
      var fpsMult = state.fps === 60 ? 1.35 : 0.82;
      var fmtMult = state.format === "webm" ? 0.84 : 1.0;
      var mb = (13.6 * r[1] * q[1] * fpsMult * fmtMult).toFixed(1);
      if (specSummary) specSummary.textContent = r[0] + " · " + state.fps + " fps · " + state.format.toUpperCase() + " · " + q[0];
      if (estSize) estSize.textContent = "~" + mb + " MB (42s)";
    }

    function bindGroup(attr, key, parser) {
      $$("[" + attr + "]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          $$("[" + attr + "]").forEach(function (b) { b.classList.remove("is-active"); });
          btn.classList.add("is-active");
          var raw = btn.getAttribute(attr);
          state[key] = parser ? parser(raw) : raw;
          updateSummary();
        });
      });
    }

    bindGroup("data-exp-format", "format");
    bindGroup("data-exp-res", "res");
    bindGroup("data-exp-fps", "fps", Number);
    bindGroup("data-exp-qual", "qual");
    updateSummary();

    function openModal() {
      modal.classList.add("is-open");
      if (progWrap) progWrap.classList.remove("is-active");
      if (progFill) progFill.style.width = "0%";
    }
    function closeModal() {
      clearInterval(simTimer);
      modal.classList.remove("is-open");
    }

    openBtns.forEach(function (b) { b.addEventListener("click", openModal); });
    closeBtns.forEach(function (b) { b.addEventListener("click", closeModal); });
    modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal();
    });

    if (runBtn) {
      runBtn.addEventListener("click", function () {
        clearInterval(simTimer);
        if (progWrap) progWrap.classList.add("is-active");
        var p = 0;
        if (progMsg) progMsg.textContent = "Hardware decoding & compositing locally…";
        simTimer = setInterval(function () {
          p += 8;
          if (p >= 100) {
            p = 100;
            clearInterval(simTimer);
            if (progMsg) progMsg.textContent = "Complete! 0 bytes uploaded · Saved locally";
            showToast("Simulated local " + state.res + " " + state.format.toUpperCase() + " render complete!");
          }
          if (progPct) progPct.textContent = p + "%";
          if (progFill) progFill.style.width = p + "%";
        }, 90);
      });
    }
  }

  /* ============ 5. INVISIBLE CAPTURE BEFORE/AFTER SLIDER ============ */
  function initCompareSlider() {
    var slider = $("#compare-slider");
    var range = $("#compare-range");
    if (!slider || !range) return;
    function sync() {
      slider.style.setProperty("--pos", range.value + "%");
    }
    range.addEventListener("input", sync);
    sync();
  }

  /* ============ 6. INTERACTIVE TELEPROMPTER PREVIEW ============ */
  function initTeleprompter() {
    var scrollEl = $("#teleprompter-scroll");
    var toggleBtn = $("#prompter-toggle");
    var speedEl = $("#prompter-speed");
    if (!scrollEl || reduceMotion) return;

    var running = true;
    var y = 18;
    var speed = 2;

    if (speedEl) {
      speedEl.addEventListener("input", function () {
        speed = parseFloat(speedEl.value) || 2;
      });
    }
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function () {
        running = !running;
        toggleBtn.textContent = running ? "Pause Auto-Scroll" : "Resume Auto-Scroll";
      });
    }

    function tick() {
      if (running) {
        y -= 0.14 * speed;
        if (y < -220) y = 130;
        scrollEl.style.transform = "translateY(" + y.toFixed(1) + "px)";
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ============ 7. EMBED BACKLINK BADGE COPIER ============ */
  function initEmbedBacklink() {
    var preview = $("#embed-code-preview");
    var copyBtn = $("#copy-embed-btn");
    var fmts = $$("[data-embed-fmt]");
    if (!preview) return;

    var snippets = {
      md: "[![Recorded with RecordFlow](https://img.shields.io/badge/Recorded%20with-RecordFlow-ff6b4a?style=flat-square)](https://waqar-743.github.io/RecordFlow/)",
      html: '<a href="https://waqar-743.github.io/RecordFlow/" rel="noopener" target="_blank">Recorded with RecordFlow — Free Windows Screen Recorder</a>'
    };

    fmts.forEach(function (btn) {
      btn.addEventListener("click", function () {
        fmts.forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        var key = btn.getAttribute("data-embed-fmt");
        preview.textContent = snippets[key] || snippets.md;
      });
    });

    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var text = preview.textContent || "";
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            showToast("Backlink snippet copied to clipboard!");
          }).catch(function () {
            showToast("Snippet selected — press Ctrl+C to copy.");
          });
        } else {
          showToast("Copy the snippet above with Ctrl+C.");
        }
      });
    }
  }

  /* ============ 8. FAQ ACCORDION ============ */
  function initFaq() {
    var items = $$(".faq-item");
    items.forEach(function (item) {
      var q = $(".faq-q", item);
      if (!q) return;
      q.addEventListener("click", function () {
        var wasOpen = item.classList.contains("is-open");
        items.forEach(function (other) {
          other.classList.remove("is-open");
          var b = $(".faq-q", other);
          if (b) b.setAttribute("aria-expanded", "false");
        });
        if (!wasOpen) {
          item.classList.add("is-open");
          q.setAttribute("aria-expanded", "true");
        }
      });
    });
  }

  /* ============ 9. SCROLL REVEAL & ACTIVE NAV ============ */
  function initScrollEnhancements() {
    var reveals = $$("[data-reveal]");
    if (reduceMotion || !("IntersectionObserver" in window)) {
      reveals.forEach(function (el) { el.classList.add("is-visible"); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });
      reveals.forEach(function (el) { io.observe(el); });
    }

    var navLinks = $$(".nav__link");
    var map = {};
    navLinks.forEach(function (l) {
      var h = l.getAttribute("href") || "";
      if (h.charAt(0) === "#") map[h.slice(1)] = l;
    });
    if ("IntersectionObserver" in window && Object.keys(map).length) {
      var navIo = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && map[entry.target.id]) {
            navLinks.forEach(function (l) { l.classList.remove("is-active"); });
            map[entry.target.id].classList.add("is-active");
          }
        });
      }, { rootMargin: "-35% 0px -55% 0px", threshold: 0 });
      Object.keys(map).forEach(function (id) {
        var sec = document.getElementById(id);
        if (sec) navIo.observe(sec);
      });
    }
  }

  /* ============ 10. LIVE GITHUB RELEASE & STARS ENRICHMENT ============ */
  function initGitHubLiveMeta() {
    if (!("fetch" in window)) return;
    fetch("https://api.github.com/repos/Waqar-743/RecordFlow")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (repo) {
        if (!repo || typeof repo.stargazers_count !== "number") return;
        $$("[data-gh-stars]").forEach(function (el) {
          el.textContent = "★ " + repo.stargazers_count;
        });
      })
      .catch(function () {});

    fetch("https://api.github.com/repos/Waqar-743/RecordFlow/releases/latest")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rel) {
        if (!rel || !rel.tag_name) return;
        var tag = rel.tag_name;
        var releaseUrl = rel.html_url || "https://github.com/Waqar-743/RecordFlow/releases/latest";
        $$("[data-latest-version]").forEach(function (el) { el.textContent = tag; });
        $$("[data-dl-release], [data-dl-exe], [data-dl-msi]").forEach(function (a) {
          a.href = releaseUrl;
        });
        var exe = (rel.assets || []).find(function (a) { return /\.exe$/i.test(a.name); });
        var msi = (rel.assets || []).find(function (a) { return /\.msi$/i.test(a.name); });
        if (exe) {
          var exeMb = (exe.size / (1024 * 1024)).toFixed(2) + " MB";
          $$("[data-exe-name]").forEach(function (el) { el.textContent = exe.name; });
          $$("[data-exe-meta]").forEach(function (el) { el.textContent = exeMb + " · Windows x64 · Official GitHub Release"; });
          $$("[data-release-eyebrow]").forEach(function (el) { el.textContent = "Windows 10/11 · " + tag + " · " + exeMb + " Native App"; });
        }
        if (msi) {
          var msiMb = (msi.size / (1024 * 1024)).toFixed(2) + " MB";
          $$("[data-msi-name]").forEach(function (el) { el.textContent = msi.name; });
          $$("[data-msi-meta]").forEach(function (el) { el.textContent = msiMb + " · Windows x64 (en-US) · Official Release"; });
        }
      })
      .catch(function () {});
  }

  document.addEventListener("DOMContentLoaded", function () {
    $$("[data-year]").forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
    initThemes();
    initMobileMenu();
    initStudio();
    initExportModal();
    initCompareSlider();
    initTeleprompter();
    initEmbedBacklink();
    initFaq();
    initScrollEnhancements();
    initGitHubLiveMeta();
  });
})();
