/** Promise-based delay in ms (avoids deprecated page.waitForTimeout). */
export function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
