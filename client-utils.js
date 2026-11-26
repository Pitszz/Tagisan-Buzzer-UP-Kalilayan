/**
 * Shared sound effects, iOS/autoplay audio unlocking, and haptic feedback
 * used across the player buzzer, host control panel, and spectator display.
 */
(function (global) {
    const AudioCtx = global.AudioContext || global.webkitAudioContext;
    // 1-sample 16-bit mono 22050Hz silent PCM WAV to unlock iOS Safari's media audio session
    const SILENT_WAV_DATA_URI = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQIAAAAAAA==";
    let audioCtx = null;
    let silentAudioUnlocked = false;
    let silentAudioEl = null;

    function isIOSDevice() {
        const nav = global.navigator;
        if (!nav) return false;
        return /iPad|iPhone|iPod/.test(nav.userAgent || "") ||
            (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
    }

    // Use the media playback session on iOS 17+ so Web Audio is audible even with the silent switch on
    function ensurePlaybackAudioSession() {
        try {
            if (global.navigator && global.navigator.audioSession && global.navigator.audioSession.type !== "playback") {
                global.navigator.audioSession.type = "playback";
            }
        } catch (_) {
            // Safe to ignore when AudioSession API is unavailable or restricted
        }
    }

    function unlockSilentHtmlAudio() {
        if (silentAudioUnlocked || !isIOSDevice()) return;
        try {
            if (!silentAudioEl) {
                silentAudioEl = new Audio(SILENT_WAV_DATA_URI);
                silentAudioEl.playsInline = true;
                silentAudioEl.setAttribute("playsinline", "");
                silentAudioEl.preload = "auto";
            }
            const playPromise = silentAudioEl.play();
            if (playPromise && typeof playPromise.then === "function") {
                playPromise.then(() => {
                    silentAudioUnlocked = true;
                }).catch(() => {});
            } else {
                silentAudioUnlocked = true;
            }
        } catch (_) {
            // Ignore if blocked outside a valid user gesture
        }
    }

    function isAudioUnlocked() {
        return Boolean(audioCtx && audioCtx.state === "running");
    }

    function getAudioContext() {
        if (!AudioCtx) return null;
        if (!audioCtx || audioCtx.state === "closed") {
            audioCtx = new AudioCtx();
        }
        return audioCtx;
    }

    function primeSilentBuffer(ctx) {
        try {
            const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start(0);
        } catch (_) {
            // Safe to ignore if context isn't ready yet
        }
        return ctx;
    }

    // Unlock Web Audio on a user gesture (required by iOS Safari and browser autoplay rules).
    function unlockAudio() {
        ensurePlaybackAudioSession();
        unlockSilentHtmlAudio();

        const ctx = getAudioContext();
        if (!ctx) return Promise.resolve(null);

        // Prime synchronously inside the gesture first, then resume if suspended/interrupted (iOS)
        primeSilentBuffer(ctx);

        if (ctx.state !== "running") {
            return ctx.resume().then(() => primeSilentBuffer(ctx)).catch(() => ctx);
        }
        return Promise.resolve(ctx);
    }

    // Unlock audio on valid user-activation gestures (avoid touchstart/pointerdown which fail iOS unlock)
    ["touchend", "mouseup", "click", "keydown"].forEach((evt) => {
        document.addEventListener(evt, () => {
            if (!isAudioUnlocked() || (isIOSDevice() && !silentAudioUnlocked)) {
                unlockAudio();
            }
        }, { passive: true });
    });

    // Schedules a single synthesized note with a soft attack so notes never click
    function playTone(ctx, { type = "sine", freq, start = 0, duration = 0.2, gain = 0.2 }) {
        const t0 = ctx.currentTime + start;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);

        env.gain.setValueAtTime(0.001, t0);
        env.gain.linearRampToValueAtTime(gain, t0 + 0.008);
        env.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

        osc.connect(env);
        env.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + duration + 0.01);
    }

    function playSound(type) {
        const ctx = getAudioContext();
        if (!ctx) return;

        const playCue = () => {
            if (type === "buzz") {
                // Classic bright two-tone quiz show ring-in bell (E5 -> B5)
                playTone(ctx, { type: "triangle", freq: 659.25, start: 0.00, duration: 0.22, gain: 0.28 });
                playTone(ctx, { type: "sine",     freq: 1318.51, start: 0.00, duration: 0.18, gain: 0.12 });
                playTone(ctx, { type: "triangle", freq: 987.77, start: 0.07, duration: 0.36, gain: 0.30 });
                playTone(ctx, { type: "sine",     freq: 1975.53, start: 0.07, duration: 0.30, gain: 0.14 });
            } else if (type === "correct") {
                // Classic ascending major chime (C5 -> E5 -> G5 -> C6)
                playTone(ctx, { type: "triangle", freq: 523.25,  start: 0.00, duration: 0.20, gain: 0.22 });
                playTone(ctx, { type: "triangle", freq: 659.25,  start: 0.08, duration: 0.20, gain: 0.22 });
                playTone(ctx, { type: "triangle", freq: 783.99,  start: 0.16, duration: 0.22, gain: 0.24 });
                playTone(ctx, { type: "triangle", freq: 1046.50, start: 0.24, duration: 0.42, gain: 0.28 });
                playTone(ctx, { type: "sine",     freq: 2093.00, start: 0.24, duration: 0.34, gain: 0.09 });
            } else if (type === "wrong") {
                // Low two-step error buzz
                const now = ctx.currentTime;
                const osc = ctx.createOscillator();
                const gainNode = ctx.createGain();
                osc.connect(gainNode);
                gainNode.connect(ctx.destination);

                osc.type = "square";
                osc.frequency.setValueAtTime(180, now);
                osc.frequency.setValueAtTime(110, now + 0.15);

                gainNode.gain.setValueAtTime(0.2, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

                osc.start(now);
                osc.stop(now + 0.35);
            }
        };

        if (ctx.state !== "running") {
            ctx.resume().then(playCue).catch(() => {});
            return;
        }
        playCue();
    }

    function triggerVibration(pattern = 200) {
        if (!global.navigator || typeof global.navigator.vibrate !== "function") return false;
        try {
            return Boolean(global.navigator.vibrate(pattern));
        } catch (err) {
            // Ignored on platforms like iOS Safari that don't support navigator.vibrate
            return false;
        }
    }

    // Minimal fullscreen toggle: hides while already fullscreen, reappears when exited.
    function setupFullscreenButton(buttonId) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;

        const root = document.documentElement;
        const requestFs = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;

        if (typeof requestFs !== "function") {
            btn.classList.add("hidden");
            return;
        }

        function isInFullscreen() {
            const mediaMatch = global.matchMedia && global.matchMedia("(display-mode: fullscreen)").matches;
            return Boolean(document.fullscreenElement || document.webkitFullscreenElement || mediaMatch);
        }

        function syncButtonVisibility() {
            btn.classList.toggle("hidden", isInFullscreen());
        }

        btn.addEventListener("click", () => {
            if (isInFullscreen()) return;
            try {
                const res = requestFs.call(root);
                if (res && typeof res.catch === "function") {
                    res.catch(() => {});
                }
            } catch (_) {
                // Ignore if browser rejects fullscreen request
            }
        });

        document.addEventListener("fullscreenchange", syncButtonVisibility);
        document.addEventListener("webkitfullscreenchange", syncButtonVisibility);
        global.addEventListener("resize", syncButtonVisibility);
        syncButtonVisibility();
    }

    global.unlockAudio = unlockAudio;
    global.playSound = playSound;
    global.triggerVibration = triggerVibration;
    global.setupFullscreenButton = setupFullscreenButton;
})(window);
