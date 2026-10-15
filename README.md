# Cubit (web)

**Open it: https://mohamedaatif-caivan.github.io/cubit/**

A fast, exact construction calculator for feet, inches and metres, as an installable web app. It's the web version of the Cubit desktop app and gives the same answers: the engine is a TypeScript port of the desktop engine and is checked against the same hand-checked tables and tests.

Open it in any browser, or install it so it gets its own window and icon:

- **Windows (Chrome or Edge):** the **Install** button at the top of Cubit, or the install icon in the address bar.
- **Android (Chrome):** **Install** at the top of Cubit, or ⋮ → **Add to Home screen**.
- **iPhone/iPad:** open the link **in Safari** (not inside Teams or WhatsApp), then **Share → Add to Home Screen**. Safari clears data from sites that aren't installed after 7 days without a visit, and data in a Safari tab doesn't move into the installed app, so install first.

Once loaded it works offline.

## What it does

- **Construction notation:** `5'6 1/2"`, `5'-6 1/2"`, `6-1/2"`, `5 ft 6.5 in`, `1.2m + 300mm`. Curly quotes (`5’6”`) work too.
- **Operators in colour:** + − × ÷ are tinted as you type, so you can see whether `4'-2"` was read as one length or as a subtraction. Mistakes get a red wavy underline; Enter shows the reason.
- **Every unit at once:** feet-inches, inches, decimal feet and inches, yards, m, cm, mm (areas and volumes too). Click a unit to show answers in it; its copy button copies it (Shift+click includes the unit).
- **Answers in your unit:** with **Auto** on, the answer shows in the first unit you type (`1m + 1` → 2 m).
- **Numbers without a unit** take the unit of the sum: `1m + 1` shows a faint m that's written in when you type the next operator. Mixed units are never guessed.
- **Area, volume, waste, conversions:** `12' x 14'`, `16 yd3 + 10%`, `… to mm`, `sqrt(9'^2 + 12'^2)`.
- **Copy that pastes cleanly** into Excel and CAD, with copy options for format and rounding (nearest, up, down, any step).
- **Tape** with notes, CSV export and undo; **saved values** (`@wall`) and memory (`MR`, `M+`, `mem`); `ans` is the last answer.
- **Phones:** a keypad with ' and " keys, and no pop-up keyboard (turn on **Settings → Device keyboard** to type with yours). Press and hold for the right-click menus.
- **Compact layout** (Ctrl+M): the calculation, the result and every unit as a row of chips.

Data stays in your browser. **Settings → Your data** downloads a backup and imports one, including `state.json` from the desktop app (`%AppData%\Cubit`).

## Accuracy

No binary floating point anywhere in the engine: every value is an exact fraction (`bigint` numerator and denominator) and units use their legal definitions (1 in = 25.4 mm exactly). Rounding happens only when a value is shown or copied, and `≈` marks a rounded display.

The tests are a port of the desktop suite (see the desktop repo's `docs/ACCURACY.md`):

| Tests | What they check |
| --- | --- |
| `golden.test.ts` | Every row of `src/core/verification/*.tsv`, the desktop app's hand-checked answers and error cases |
| `property.test.ts` | Thousands of random mixed-unit inputs against an independent integer oracle in nanometres |
| `units.test.ts` | Each unit factor against its published value and against the other units |
| `session.test.ts` | Screen behaviour: stale results, assumed units, copy, tape, saved values, memory, undo |
| `architecture.test.ts` | `src/core` never uses `Math.`, `parseFloat` or float literals, and imports nothing outside itself |
| `highlight.test.ts`, `customRounding.test.ts`, `rational.test.ts`, `workspace.test.ts` | Operator colouring, custom copy steps, exact arithmetic, saved data |

**Settings → Verify calculations** re-runs the hand-checked tables on the user's own device.

The `.tsv` files are copies of the desktop app's `src/Cubit.Core/Verification` tables. When a row is added there, copy the file here too.

## Develop

Needs Node 24.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # the accuracy suite
npm run build      # type check + tests + production build in dist/
```

| Path | Contents |
| --- | --- |
| `src/core` | The engine, one file per desktop `Cubit.Core` file: rationals, units, lexer, parser, evaluator, unit inference, formatting, copy presets, session, saved state. No UI and no dependencies. |
| `src/ui` | Preact UI. `store.ts` adapts `CalculatorSession` to the page, `ExpressionInput.tsx` is the coloured calculation box. |
| `tests` | vitest suite |
| `scripts/make_icons.py` | Draws the icons into `public/` (needs Pillow) |

## Publish on GitHub Pages

1. Push this folder to a GitHub repository (branch `main`).
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` runs the tests and deploys to `https://<user>.github.io/<repo>/`. A failing test stops the deploy.

Paths are relative, so it works under any repository name. Installed copies pick up a new version in the background and show **Update ready · Restart now**. Settings shows the version with the commit it was built from (e.g. `0.2.0+9fffd38`).

### Rolling back a bad deploy

`git revert <commit> && git push` redeploys the previous behaviour in about a minute; open copies see it as a normal "Update ready". (Re-running an older Actions run also works, as long as you re-run all its jobs.)

### Keyboard

The desktop app's shortcuts work, with one addition: browsers can keep **Ctrl+1…9** for switching tabs, so **Alt+1…9** also inserts a saved value.

### Before changing the address

Installs and saved data belong to the address they were made on (`mohamedaatif-caivan.github.io`). Moving to another domain later means everyone reinstalls and moves their data with **Settings → Your data → Download / Import**.
