/** JavaScript engines may differ in the last trigonometric digits. Round before
 * composing SVG paths and seeded grain so server and browser geometry agrees. */
export const stableSin = (value: number) => Number(Math.sin(value).toFixed(12));
export const stableCos = (value: number) => Number(Math.cos(value).toFixed(12));
