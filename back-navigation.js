/**
 * Shared back/Escape navigation guard for host, player, and spectator views.
 * Prompts the user before leaving for the main menu (index.html).
 */
(function (global) {
    const DEFAULT_PROMPT = "Are you sure you want to go back to main menu?";

    function setupBackToMenuFallback(options = {}) {
        const message = options.message || DEFAULT_PROMPT;
        const targetUrl = options.targetUrl || "index.html";
        let isPromptOpen = false;
        let isLeaving = false;

        function resolveSocket() {
            if (typeof options.getSocket === "function") {
                return options.getSocket();
            }
            return options.socket;
        }

        function leaveToMainMenu() {
            isLeaving = true;
            if (typeof options.onBeforeLeave === "function") {
                options.onBeforeLeave();
            }
            const socket = resolveSocket();
            if (socket && typeof socket.disconnect === "function") {
                socket.disconnect();
            }
            global.location.href = targetUrl;
        }

        function confirmBackToMainMenu(event) {
            if (event && typeof event.preventDefault === "function") {
                event.preventDefault();
            }
            if (isPromptOpen || isLeaving) {
                return false;
            }

            isPromptOpen = true;
            const confirmed = global.confirm(message);
            isPromptOpen = false;

            if (confirmed) {
                leaveToMainMenu();
                return true;
            }
            return false;
        }

        // Push a guard state so browser Back triggers popstate instead of leaving silently.
        if (global.history && typeof global.history.pushState === "function") {
            if (!global.history.state || !global.history.state.mainMenuGuard) {
                global.history.pushState({ mainMenuGuard: true }, "", global.location.href);
            }

            global.addEventListener("popstate", () => {
                if (isLeaving) return;
                const left = confirmBackToMainMenu();
                if (!left) {
                    global.history.pushState({ mainMenuGuard: true }, "", global.location.href);
                }
            });
        }

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape" || event.repeat) return;
            confirmBackToMainMenu(event);
        });

        global.confirmBackToMainMenu = confirmBackToMainMenu;
        return confirmBackToMainMenu;
    }

    global.setupBackToMenuFallback = setupBackToMenuFallback;
})(window);
