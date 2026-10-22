# Fonts

All fonts here are under the SIL Open Font License 1.1 (license texts next to
them). Everything is self-hosted: nothing is fetched from a font CDN.

| File | From | Native size | Used for |
|---|---|---|---|
| `RandoPixel9-*.woff2` | Galmuri9 2.40.3 | 10px | body and dialog text (20px = 2×) |
| `RandoPixel11-Bold-*.woff2` | Galmuri11 Bold 2.40.3 | 12px | titles, big numbers (24/36/48px) |
| `RandoPixel14-*.woff2` | Galmuri14 2.40.3 | 15px | secondary text (15px = 1×) |
| `Silkscreen-latin.woff2`, `Silkscreen-Bold-latin.woff2` | Silkscreen (Fontsource) | 8px | English-only labels and buttons (16/24px) |

- **Galmuri** (Korean + English pixel fonts by Lee Minseo, https://github.com/quiple/galmuri) has the Reserved Font Name "Galmuri".
  - The files here are subsets: a Latin part and a Hangul part, split with `unicode-range`. Phones only download the Hangul part when Korean text is on screen.
  - The OFL requires a modified version to drop the reserved name, so the subsets are renamed **RandoPixel**. The copyright and license notices are kept inside each file.
  - License: `Galmuri-OFL.md`.
- **Silkscreen** (Jason Kottke; the Silkscreen Project Authors) is used unmodified, from Fontsource. It has no Hangul, so only use it for fixed English UI labels, never for names, prompts or answers.
  - License: `Silkscreen-OFL.txt`.

**Rendering:** pixel fonts stay crisp only at whole multiples of their native size. Use the `--fs-*` tokens in `theme.css`; never set an arbitrary size on a pixel font.

**Regenerating the subsets:** use fontTools: `pyftsubset`, then rename name IDs 1/3/4/6. The `unicode-range` values are in `theme.css`.
