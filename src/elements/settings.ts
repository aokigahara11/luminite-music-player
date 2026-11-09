export const elements = {
    equalizerPreset: document.getElementById("equalizer-preset") as HTMLSelectElement,
    equalizerResetBtn: document.getElementById("equalizer-reset-btn") as HTMLButtonElement,
    equalizerBands: document.getElementById("equalizer-bands") as HTMLElement,
    transitionDuration: document.getElementById("transition-duration") as HTMLInputElement,
    transitionDurationValue: document.getElementById("transition-duration-value") as HTMLOutputElement,
    settingsStatus: document.getElementById("settings-status") as HTMLElement,
    discordRcpToggle: document.getElementById("apply-discord-rcp") as HTMLButtonElement,
    themeRadios: document.querySelectorAll<HTMLInputElement>('input[name="app-theme"]'),
    openShortcutBtn: document.getElementById("open-view-shortcut-btn") as HTMLButtonElement,
    shortcutsModal: document.getElementById("shortcuts-modal") as HTMLElement,
    closeShortcutsModalBtn: document.getElementById("close-shortcuts-modal-btn") as HTMLButtonElement
};
