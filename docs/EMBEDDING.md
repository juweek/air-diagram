# Embedding a tool in another site

Every page in this template is iframe-ready: it runs standalone, makes no
assumptions about its host, and reports its own height so the frame can
auto-resize. Results are URL-addressable, so you can embed a *specific* result
(`…/air/77002`), not just the empty form.

## Host-page snippet

```html
<iframe
  id="gourmet-tool"
  src="https://YOUR-DEPLOYMENT.vercel.app/air/77002"
  style="width: 100%; border: 0;"
  title="Air quality lookup"
></iframe>
<script>
  // Matches the child snippet in src/lib/embedHeight.js.
  window.addEventListener('message', (e) => {
    if (e.data?.type !== 'gourmet-data:height') return;
    document.getElementById('gourmet-tool').style.height = e.data.height + 'px';
  });
</script>
```

If the host page embeds multiple tools, check `e.source` against each frame's
`contentWindow` to route the height to the right iframe.

## Serving from a subpath

If a deployment must live under a subpath (e.g. `example.com/tools/air/`),
build with the base knob:

```sh
VITE_BASE=/tools/air/ npm run build
```

Everything (router, static data fetches, assets) resolves against it.
