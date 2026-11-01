import { elements } from "../elements";

let toastTimer: number | undefined;
let toastHideTimer: number | undefined;

export function showToast(message: string, isError = false): void {
    window.clearTimeout(toastTimer);
    window.clearTimeout(toastHideTimer);
    elements.appToast.hidden = false;
    elements.appToast.classList.remove("is-visible");
    elements.appToast.classList.toggle("is-error", isError);
    elements.appToastMessage.textContent = message;
    elements.appToastIcon.innerHTML = isError
        ? `<circle cx="12" cy="12" r="9"></circle><path d="m9 9 6 6m0-6-6 6"></path>`
        : `<circle cx="12" cy="12" r="9"></circle><path d="m8 12 2.5 2.5L16 9"></path>`;

    requestAnimationFrame(() => elements.appToast.classList.add("is-visible"));
    toastTimer = window.setTimeout(() => {
        elements.appToast.classList.remove("is-visible");
        toastHideTimer = window.setTimeout(() => {
            elements.appToast.hidden = true;
        }, 160);
    }, 2000);
}
