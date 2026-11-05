# Build Rules

These rules apply to every product and build unless a specific project says otherwise.

## 1. Visual style — clean, white, minimal

**Reference site:** https://infinitum-corporation.vercel.app/
All product UIs follow this site: clean, white, calm and content-first (in the spirit of ChatGPT's interface).

**Color tokens (copy exactly)**
```css
:root {
  --ink:    #111820; /* primary text */
  --muted:  #52606b; /* secondary text */
  --line:   #d6dce1; /* borders, dividers (1px) */
  --accent: #2454dd; /* primary actions, links, focus only */
  --paper:  #ffffff; /* background */
  --m-ease: cubic-bezier(.22,1,.36,1); /* motion easing */
}
```
- White background everywhere; one accent color only
- No gradients, no heavy shadows

**Typography**
- Font stack for everything: `"Helvetica Neue", Helvetica, Arial, sans-serif`
- No web fonts or decorative fonts
- Weight 400 for headings and body; 500 only for product names
- Large headings get tight tracking: H1 48px / letter-spacing ≈ −0.065em; H2 ≈ 43px / ≈ −0.055em
- H3 22px; body 16px; lead paragraphs 18px with ≈ −0.015em tracking; small labels 12px in `--muted`

**Product logos = text wordmarks**
- Product logos are text wordmarks, not image logos: the product name, set in the brand font, including its symbols
- Write each name exactly as shown, symbols included, with ™ attached. Full product list:

  | Product | Wordmark |
  |---|---|
  | Argus | `>_ARGUS™` |
  | Conductor | `/CNDCTR/™` |
  | Scalvs | `SCALVS.ai™` |
  | Flower | `Flower™` |
  | Nemesis | `NEMESIS™` |
  | Orbis | `ORBIS™` |
  | Pollen | `POLLEN™` |
  | Eidetic | `ei·det·ic™` |
  | Harvest | `[HRVST]™` |
  | Metatron | `METATRON™` |
  | Spectre | `+SPCTR™` |
  | Odin | `ODIN°™` |
  | Aether | `ÆTHER™` |
  | Aether MIL | `ÆTHER™ MIL` |
  | Eon | `E(O)N™` |
  | Fabric | `FABRIC™` |
  | Veil | `VEIL</>™` |
  | Firm | `FIRM™` |
  | Firm Wallet | `FIRM Wallet™` |
  | Firmament Network | `Firmament Network™` |
  | Cumulus Cloud | `Cumulus://Cloud™` |
  | Throne | `#THRONE™` |
  | Throne MIL | `#THRONE™ MIL` |

- **™ on every product, every time:** every product name, edition (MIL, Wallet etc.) and new product carries ™ wherever it appears (UI, headings, nav, footers, docs, READMEs, page titles, metadata). Trademarked phrases do too, e.g. "Blockchain-governed™".
- Render ™ at roughly 0.6em, raised (`<sup>`); in plain text (titles, READMEs, commit messages) use the ™ character directly
- Wordmark style: Helvetica Neue, weight 500, color `--ink`, normal tracking
- The Infinitum Corporation parent mark uses ®
- New products get a wordmark built the same way: an uppercase name plus one signature symbol, and ™

**Layout**
- Generous whitespace; content column max ~768px for reading views
- Centered, single-focus screens; one primary action per view
- 8px spacing grid
- Rounded corners: 8–12px on inputs, cards and buttons; fully rounded for pills
- Sidebar (if needed) is quiet: light gray background, collapsible

**Components**
- Buttons: solid dark (or accent) for primary, ghost/outline for secondary
- Inputs: large, rounded, subtle border, clear focus ring
- Icons: thin outline style, one set across the product
- Motion: short and subtle (150–200ms ease), never decorative

**Avoid**
- Clutter, badges everywhere, competing calls to action
- Stock illustrations and busy imagery
- More than one accent color
- Dense tables without breathing room

## 2. Repositories — one new GitHub repo per build

- Every new build gets its own new GitHub repository; builds never share a repo.
- Naming: lowercase kebab-case, e.g. `product-name` or `product-name-web`.
- Each repo starts with:
  - `README.md` — what it is, how to run it, how to deploy
  - `.gitignore` suited to the stack
  - `BUILD_RULES.md` — a copy of this file
  - `LICENSE` (if the project will be public)
- Default branch: `main`. Visibility: private unless stated otherwise.
- First commit contains the scaffold; work proceeds in small, descriptive commits.

## 3. Hosting — GitHub + Cloudflare (not Vercel)

- **Stack:** code lives on GitHub; everything is hosted on Cloudflare. Don't use Vercel for new builds.
- **Static sites and front-ends:** Cloudflare Pages, connected to the product's GitHub repo
  - `main` branch → production
  - Every other branch / pull request → automatic preview deployment
- **APIs and server logic:** Cloudflare Workers (Pages Functions for small endpoints)
- **Data and storage (when needed):** D1 (SQL), KV (key-value), R2 (files/objects)
- **Domains and DNS:** managed in Cloudflare; SSL always on, HTTPS-only
- **Config in the repo:** `wrangler.toml` checked in; secrets set in Cloudflare (`wrangler secret put`), never committed
- **README** of each repo lists the Cloudflare project name, production URL and deploy steps
- Existing Vercel projects (e.g. infinitum-corporation.vercel.app) move to Cloudflare Pages when they're next updated

## 4. Permissions — always proceed

- Permission is granted in advance for all routine build work: scaffolding, writing code, installing packages, creating repos, committing and pushing, and deploying to Cloudflare preview and production.
- Don't stop to ask before these steps; make sensible choices and note them in the README or final summary.
- Still confirm first for anything irreversible or outside the build itself: deleting repos or data, spending money, publishing publicly, or sending messages on the owner's behalf.

## 5. Applying these rules

- These rules are the default for all products; a project may override a rule only by stating the exception in its own README.
- When in doubt, remove rather than add.
