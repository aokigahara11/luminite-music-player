function getCarouselTarget(button: HTMLButtonElement): HTMLElement | null {
    const targetId = button.dataset.homeCarouselTarget;
    return targetId ? document.getElementById(targetId) : null;
}

export function updateHomeCarouselControls(): void {
    document.querySelectorAll<HTMLButtonElement>("[data-home-carousel-target]").forEach((button) => {
        const target = getCarouselTarget(button);
        if (!target)
            return;

        const maxScroll = Math.max(0, target.scrollWidth - target.clientWidth);
        const direction = button.dataset.homeCarouselDirection;
        const controls = button.closest<HTMLElement>(".home-carousel-controls");
        if (controls)
            controls.hidden = maxScroll <= 1;
        button.disabled = maxScroll <= 1 || (direction === "previous"
            ? target.scrollLeft <= 1
            : target.scrollLeft >= maxScroll - 1);
    });
}

export function setupHomeCarouselControls(): void {
    const targets = new Set<HTMLElement>();
    document.querySelectorAll<HTMLButtonElement>("[data-home-carousel-target]").forEach((button) => {
        const target = getCarouselTarget(button);
        if (!target)
            return;
        targets.add(target);
        button.addEventListener("click", () => {
            const direction = button.dataset.homeCarouselDirection === "previous" ? -1 : 1;
            target.scrollBy({
                left: direction * Math.max(1, target.clientWidth * 0.85),
                behavior: "smooth",
            });
        });
    });

    targets.forEach((target) => {
        target.addEventListener("scroll", updateHomeCarouselControls, { passive: true });
    });

    const resizeObserver = new ResizeObserver(updateHomeCarouselControls);
    targets.forEach((target) => resizeObserver.observe(target));
    window.addEventListener("resize", updateHomeCarouselControls);
    updateHomeCarouselControls();
}
