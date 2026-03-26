// tests/setup.ts
import '@testing-library/jest-dom'

/**
 * jsdom warns "Not implemented: navigation to another Document" when
 * `HTMLAnchorElement.prototype.click()` runs on `<a download href="blob:...">`.
 * Browsers treat that as a download, not navigation. Short-circuit for the download case.
 */
const originalAnchorClick = HTMLAnchorElement.prototype.click
HTMLAnchorElement.prototype.click = function anchorClick(this: HTMLAnchorElement) {
  if (this.hasAttribute('download')) return
  return originalAnchorClick.call(this)
}
