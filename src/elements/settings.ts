export const elements = {
    equalizerPreset: document.getElementById("equalizer-preset") as HTMLSelectElement,
    equalizerResetBtn: document.getElementById("equalizer-reset-btn") as HTMLButtonElement,
    equalizerBands: document.getElementById("equalizer-bands") as HTMLElement,
    transitionDuration: document.getElementById("transition-duration") as HTMLInputElement,
    transitionDurationValue: document.getElementById("transition-duration-value") as HTMLOutputElement,
    settingsStatus: document.getElementById("settings-status") as HTMLElement,
    themeRadios: document.querySelectorAll<HTMLInputElement>('input[name="app-theme"]')
};
