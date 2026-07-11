/**
 * Child half of the iframe auto-height handshake (~15 lines, self-owned — no
 * pym.js / iframe-resizer dependency to manage). Posts our content height to
 * the parent on load and whenever the document resizes. The matching parent
 * snippet lives in docs/EMBEDDING.md.
 *
 * No-op when the page is not framed. Never READS from the parent — each tool
 * must run standalone with no assumptions about its host.
 */
export function reportHeightToParent() {
  if (window.parent === window) return; // not embedded

  const post = () => {
    window.parent.postMessage(
      { type: 'gourmet-data:height', height: document.documentElement.scrollHeight },
      '*'
    );
  };
  new ResizeObserver(post).observe(document.documentElement);
  window.addEventListener('load', post);
  post();
}
