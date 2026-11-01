export function formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds <= 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

export function truncate(text: string, maxLength: number = 40): string {
    if (text.length > maxLength) {
        return text.slice(0, maxLength) + "...";
    }
    return text;
}

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[character] ?? character);
}
