import { closeModal, openModal } from "../core/views";

export function setupAppGuide(): void {
    const openButton = document.getElementById("open-app-guide-btn") as HTMLButtonElement;
    const modal = document.getElementById("app-guide-modal") as HTMLElement;
    const closeButton = document.getElementById("close-app-guide-btn") as HTMLButtonElement;
    const previousButton = document.getElementById("app-guide-prev-btn") as HTMLButtonElement;
    const nextButton = document.getElementById("app-guide-next-btn") as HTMLButtonElement;
    const nextLabel = document.getElementById("app-guide-next-label") as HTMLElement;
    const slides = Array.from(modal.querySelectorAll<HTMLElement>("[data-guide-slide]"));
    const dots = Array.from(modal.querySelectorAll<HTMLButtonElement>("[data-guide-dot]"));

    if (slides.length === 0 || slides.length !== dots.length)
        throw new Error("Слайды и точки справки должны быть заданы попарно");

    let activeSlide = 0;
    let opener: HTMLElement | null = null;

    const renderSlide = (index: number): void => {
        activeSlide = Math.max(0, Math.min(index, slides.length - 1));
        slides.forEach((slide, slideIndex) => {
            const isActive = slideIndex === activeSlide;
            slide.hidden = !isActive;
            slide.setAttribute("aria-hidden", String(!isActive));
        });
        dots.forEach((dot, dotIndex) => {
            if (dotIndex === activeSlide)
                dot.setAttribute("aria-current", "step");
            else
                dot.removeAttribute("aria-current");
        });
        previousButton.disabled = activeSlide === 0;
        const isLastSlide = activeSlide === slides.length - 1;
        nextLabel.textContent = isLastSlide ? "Завершить" : "Далее";
        nextButton.setAttribute("aria-label", isLastSlide ? "Завершить справку" : "Следующий слайд");
    };

    const closeGuide = (): void => {
        closeModal(modal);
        opener?.focus();
        opener = null;
    };

    openButton.addEventListener("click", () => {
        opener = openButton;
        renderSlide(0);
        openModal(modal);
        closeButton.focus();
    });
    closeButton.addEventListener("click", closeGuide);
    modal.addEventListener("click", (event) => {
        if (event.target === modal)
            closeGuide();
    });
    modal.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            closeGuide();
            return;
        }
        if (event.key === "ArrowRight") {
            event.preventDefault();
            renderSlide(activeSlide + 1);
        } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            renderSlide(activeSlide - 1);
        } else if (event.key === "Tab") {
            const focusable = Array.from(modal.querySelectorAll<HTMLElement>("button:not(:disabled)"));
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });
    previousButton.addEventListener("click", () => renderSlide(activeSlide - 1));
    nextButton.addEventListener("click", () => {
        if (activeSlide === slides.length - 1)
            closeGuide();
        else
            renderSlide(activeSlide + 1);
    });
    dots.forEach((dot, index) => {
        dot.addEventListener("click", () => renderSlide(index));
    });
}
