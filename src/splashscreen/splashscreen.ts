function getWavePath(): SVGPathElement {
    const element = document.querySelector<SVGPathElement>("#wave");
    if (!element) {
        throw new Error("Не найден элемент волны загрузочного экрана.");
    }
    return element;
}

const path = getWavePath();

const POINTS = 220;
const PERIOD = 1900;
const X0 = 150;
const WIDTH = 724;
const MID = 512;
const AMP = 210;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function draw(phi: number): void {
    let d = "";
    for (let i = 0; i <= POINTS; i++) {
        const t = i / POINTS;
        const x = X0 + WIDTH * t;
        const envelope = Math.sin(Math.PI * t);
        const y = MID + AMP * envelope * Math.sin(4 * Math.PI * t - phi);
        d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    path.setAttribute("d", d);
}

draw(0);

if (!reduceMotion) {
    let start: number | null = null;

    function frame(timestamp: number): void {
        if (start === null) {
            start = timestamp;
        }
        const phase = ((timestamp - start) % PERIOD) / PERIOD * 2 * Math.PI;
        draw(phase);
        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
}
