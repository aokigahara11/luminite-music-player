const TOOLTIP_ID = "app-tooltip";
const TOOLTIP_SELECTOR = "[data-tooltip]";
const TOOLTIP_GAP = 8;
const VIEWPORT_PADDING = 8;

let tooltip: HTMLDivElement | null = null;
let hoveredElement: HTMLElement | null = null;
let focusedElement: HTMLElement | null = null;
let activeElement: HTMLElement | null = null;

const originalDescriptions = new Map<HTMLElement, string | null>();

function findTooltipTarget(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element))
        return null;

    return target.closest<HTMLElement>(TOOLTIP_SELECTOR);
}

function captureTitle(element: HTMLElement): void {
    const title = element.getAttribute("title");
    if (element.closest(".sidebar-left")) {
        element.removeAttribute("title");
        element.removeAttribute("data-tooltip");
        if (activeElement === element)
            hideTooltip();
        return;
    }

    if (title === null)
        return;

    if (title.trim()) {
        element.setAttribute("data-tooltip", title);
    } else {
        element.removeAttribute("data-tooltip");
    }

    element.removeAttribute("title");
    if (activeElement === element)
        updateTooltip();
}

function captureTitles(root: ParentNode): void {
    root.querySelectorAll<HTMLElement>("[title], [data-tooltip]").forEach(captureTitle);
    if (root instanceof HTMLElement && (root.hasAttribute("title") || root.hasAttribute("data-tooltip")))
        captureTitle(root);
}

function updateTooltip(): void {
    if (!tooltip || !activeElement)
        return;

    const text = activeElement.getAttribute("data-tooltip");
    if (!text?.trim()) {
        hideTooltip();
        return;
    }

    tooltip.textContent = text;
    tooltip.hidden = false;
    tooltip.classList.add("is-visible");

    const targetRect = activeElement.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const top = targetRect.top >= tooltipRect.height + TOOLTIP_GAP
        ? targetRect.top - tooltipRect.height - TOOLTIP_GAP
        : targetRect.bottom + TOOLTIP_GAP;
    const left = Math.min(
        Math.max(targetRect.left + (targetRect.width - tooltipRect.width) / 2, VIEWPORT_PADDING),
        window.innerWidth - tooltipRect.width - VIEWPORT_PADDING,
    );

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(VIEWPORT_PADDING, top)}px`;
}

function hideTooltip(): void {
    if (!tooltip || !activeElement)
        return;

    tooltip.classList.remove("is-visible");
    tooltip.hidden = true;

    const originalDescription = originalDescriptions.get(activeElement);
    if (originalDescription === null || originalDescription === undefined)
        activeElement.removeAttribute("aria-describedby");
    else
        activeElement.setAttribute("aria-describedby", originalDescription);
    originalDescriptions.delete(activeElement);
    activeElement = null;
}

function setActiveElement(element: HTMLElement | null): void {
    if (activeElement === element) {
        updateTooltip();
        return;
    }

    hideTooltip();
    if (!element)
        return;

    activeElement = element;
    originalDescriptions.set(element, element.getAttribute("aria-describedby"));
    const descriptions = (element.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter(Boolean);
    if (!descriptions.includes(TOOLTIP_ID))
        descriptions.push(TOOLTIP_ID);
    element.setAttribute("aria-describedby", descriptions.join(" "));
    updateTooltip();
}

export function initTooltips(): void {
    if (tooltip)
        return;

    tooltip = document.createElement("div");
    tooltip.id = TOOLTIP_ID;
    tooltip.className = "app-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    document.body.append(tooltip);

    captureTitles(document);

    new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === "attributes" && mutation.target instanceof HTMLElement) {
                captureTitle(mutation.target);
            } else {
                mutation.addedNodes.forEach((node) => {
                    if (node instanceof HTMLElement)
                        captureTitles(node);
                });
            }
        }
    }).observe(document.body, {
        attributes: true,
        attributeFilter: ["title"],
        childList: true,
        subtree: true,
    });

    document.addEventListener("pointerover", (event) => {
        hoveredElement = findTooltipTarget(event.target);
        setActiveElement(focusedElement ?? hoveredElement);
    });
    document.addEventListener("pointerout", (event) => {
        const target = findTooltipTarget(event.target);
        if (!target || target !== hoveredElement)
            return;
        if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))
            return;

        hoveredElement = null;
        setActiveElement(focusedElement);
    });
    document.addEventListener("focusin", (event) => {
        focusedElement = findTooltipTarget(event.target);
        setActiveElement(focusedElement ?? hoveredElement);
    });
    document.addEventListener("focusout", (event) => {
        const target = findTooltipTarget(event.target);
        if (!target || target !== focusedElement)
            return;
        if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))
            return;

        focusedElement = null;
        setActiveElement(hoveredElement);
    });
    window.addEventListener("resize", updateTooltip);
    window.addEventListener("scroll", updateTooltip, true);
}
