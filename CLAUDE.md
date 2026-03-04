## Text Metrics

DOM-free text measurement using canvas `measureText()` + `Intl.Segmenter`. Two-phase: `prepare()` once, `layout()` is pure arithmetic on resize. ~0.1ms for 500 comments. Full i18n.

### Commands

- `bun start` — serve pages at http://localhost:3000
- `bun run check` — typecheck + lint
- `bun test` — headless tests (HarfBuzz, 100% accuracy)

### Files

- `src/layout.ts` — the library
- `src/measure-harfbuzz.ts` — HarfBuzz backend for headless tests
- `src/test-data.ts` — shared test texts/params
- `src/layout.test.ts` — bun tests: consistency + word-sum vs full-line accuracy
- `pages/accuracy.html + .ts` — sweep across fonts, sizes, widths, i18n texts (working)
- `pages/emoji-test.html` — canvas vs DOM emoji width comparison (working)
- `pages/demo.html + .ts` — visual side-by-side comparison (TODO)
- `pages/benchmark.html + .ts` — performance comparison (TODO)
- `pages/interleaving.html + .ts` — realistic DOM interleaving demo (TODO)

### Key decisions

- Canvas over DOM: no read/write interleaving. Zero DOM reads in prepare() or layout().
- Intl.Segmenter over split(' '): handles CJK (per-character breaks), Thai, all scripts.
- Punctuation merged into preceding word: "better." measured as one unit. Reduces accumulation error (up to 2.6px at 28px without merging). Only merges into non-space preceding segments.
- Trailing whitespace hangs past line edge (CSS behavior): spaces that overflow don't trigger breaks.
- HarfBuzz with explicit LTR for headless tests: guessSegmentProperties assigns wrong direction to isolated Arabic words.

### Accuracy

- Chrome: 99.4% (3816/3840). Remaining: emoji canvas width inflation (Chrome bug, filed).
- Safari: 98.8% (3792/3840). Remaining: CSS line-breaking rule differences — emoji break opportunities, CJK kinsoku, bidi boundary breaks. NOT measurement errors.
- Firefox: similar emoji issue to Chrome but worse (+5px at 15px, converges at 28px).
- Headless (HarfBuzz): 100% (1472/1472). Algorithm is exact.

### Known limitations

- Emoji: Chrome/Firefox canvas measures emoji wider than DOM at font sizes <24px. Safari is fine. This is a browser bug (repro in `chromium-bug/`).
- system-ui font: canvas and DOM resolve to different optical variants on macOS. Use named fonts.
- Safari CSS rules: kinsoku (CJK punctuation line-start prohibition), emoji-as-break-point, bidi boundary breaks differ from our algorithm. Would need CSS line-breaking spec implementation to fix.
- Server-side: needs canvas or @napi-rs/canvas with registered fonts. HarfBuzz works for testing.

### Related

- `../text-layout/` — Sebastian Markbage's original prototype + our experimental variants (a-e) and the five-way benchmark comparing Sebastian's, ours, DOM batch, DOM interleaved, and the precise approach.

See [RESEARCH.md](RESEARCH.md) for full exploration log with measurements.

Based on Sebastian Markbage's [text-layout](https://github.com/reactjs/text-layout).
