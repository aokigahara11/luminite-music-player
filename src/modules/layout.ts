import { showToast } from "../utils/toast";

const RIGHT_PANEL_WIDTH_STORAGE_KEY = "luminite-right-panel-width";
const MIN_RIGHT_PANEL_WIDTH = 240;
const MAX_RIGHT_PANEL_WIDTH = 320;
const MIN_MAIN_CONTENT_WIDTH = 360;
const DEFAULT_RIGHT_PANEL_WIDTH = 320;

export function setupResizableSidebar(): void {
    const resizer = document.getElementById("sidebar-resizer");
    if (!(resizer instanceof HTMLElement))
        throw new Error("Не найден разделитель правой панели");

    let panelWidth = DEFAULT_RIGHT_PANEL_WIDTH;

    const getWidthLimits = () => {
        if (window.innerWidth <= 1100) {
            return { min: MIN_RIGHT_PANEL_WIDTH, max: MAX_RIGHT_PANEL_WIDTH };
        }

        const leftPanel = document.querySelector<HTMLElement>(".sidebar-left");
        const leftWidth = leftPanel?.getBoundingClientRect().width ?? 240;
        const maxWidth = Math.max(
            MIN_RIGHT_PANEL_WIDTH,
            Math.min(MAX_RIGHT_PANEL_WIDTH, window.innerWidth - leftWidth - MIN_MAIN_CONTENT_WIDTH),
        );
        return { min: MIN_RIGHT_PANEL_WIDTH, max: maxWidth };
    };

    const updatePanelWidth = (requestedWidth: number): void => {
        const limits = getWidthLimits();
        panelWidth = Math.round(Math.min(limits.max, Math.max(limits.min, requestedWidth)));
        document.documentElement.style.setProperty("--sidebar-right-panel-size", `${panelWidth}px`);
        resizer.setAttribute("aria-valuemin", limits.min.toString());
        resizer.setAttribute("aria-valuemax", limits.max.toString());
        resizer.setAttribute("aria-valuenow", panelWidth.toString());
    };

    const savePanelWidth = (): void => {
        try {
            localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, panelWidth.toString());
        } catch (error) {
            console.error("Не удалось сохранить ширину правой панели:", error);
            showToast("Не удалось сохранить ширину правой панели", true);
        }
    };

    try {
        const storedWidth = localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY);
        if (storedWidth !== null) {
            const parsedWidth = Number(storedWidth);
            if (Number.isFinite(parsedWidth)) {
                panelWidth = parsedWidth;
            } else {
                console.warn("Сохранена некорректная ширина правой панели:", storedWidth);
            }
        }
    } catch (error) {
        console.error("Не удалось загрузить ширину правой панели:", error);
        showToast("Не удалось загрузить ширину правой панели", true);
    }

    updatePanelWidth(panelWidth);

    let isDragging = false;
    const persistCurrentWidth = (): void => {
        if (!isDragging)
            return;
        isDragging = false;
        document.body.classList.remove("resizing-right-panel");
        savePanelWidth();
    };

    resizer.addEventListener("pointerdown", (event) => {
        if (event.button !== 0)
            return;
        event.preventDefault();
        resizer.setPointerCapture(event.pointerId);
        isDragging = true;
        document.body.classList.add("resizing-right-panel");
    });

    resizer.addEventListener("pointermove", (event) => {
        if (resizer.hasPointerCapture(event.pointerId))
            updatePanelWidth(window.innerWidth - event.clientX);
    });

    resizer.addEventListener("pointerup", (event) => {
        if (resizer.hasPointerCapture(event.pointerId))
            resizer.releasePointerCapture(event.pointerId);
        persistCurrentWidth();
    });

    resizer.addEventListener("pointercancel", persistCurrentWidth);
    resizer.addEventListener("lostpointercapture", persistCurrentWidth);

    resizer.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 32 : 16;
        if (event.key === "ArrowLeft") {
            updatePanelWidth(panelWidth + step);
        } else if (event.key === "ArrowRight") {
            updatePanelWidth(panelWidth - step);
        } else if (event.key === "Home") {
            updatePanelWidth(getWidthLimits().min);
        } else if (event.key === "End") {
            updatePanelWidth(getWidthLimits().max);
        } else {
            return;
        }
        event.preventDefault();
        savePanelWidth();
    });

    window.addEventListener("resize", () => updatePanelWidth(panelWidth));
}
