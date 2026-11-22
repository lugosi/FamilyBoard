---
title: Shopping lists
summary: Add shopping/Black Friday items with optional Amazon links; check local retail availability near Santa Monica CA
tags: [skill, shopping, black-friday, amazon, local-retail]
---

# Shopping lists

## When to use

Someone asks to add items to a shopping, Black Friday, gift, or wishlist (wiki page or family todos); wants an Amazon product/search link; or asks whether something is available **in-store near Santa Monica, CA** (West LA).

## Inputs

- Item name (required).
- Optional product URL the family already has (Amazon product page, store page, etc.).
- Optional target list: wiki page (e.g. `notes/black-friday.md`) or the shared todos checklist.
- Optional store preference for local checks (Target, Best Buy, Apple, Costco, Whole Foods, REI, …).

## Steps — add with Amazon offer

1. If the family named a wiki shopping list, `search_wiki` / `read_wiki_page` it first. Prefer appending a checklist line with `edit_wiki_section` (mode append) under the right `##` heading. Otherwise use `add_todo` with `shopping: true`.
2. Pass `url` when they already gave one. Prefer a specific product URL over a search URL.
3. If **no URL** was provided:
   - Still add the item.
   - Offer an Amazon product search link. Prefer the `suggestedAmazonSearchUrl` / quick-action chips returned by `add_todo` when `shopping: true`. Otherwise build `https://www.amazon.com/s?k=<urlencoded item name>`.
   - If they accept, call `update_todo` with that `url`, or rewrite the wiki line as `[Item name](url)`.
   - If they decline or say skip, leave the item without a link.
4. Never invent ASINs, prices, deal percentages, or stock counts.

## Steps — local retail near Santa Monica

1. When asked if something is available locally / nearby / in-store (Santa Monica, West LA, “near us”):
   - Call `search_web` with queries like `"<item> in stock near Santa Monica CA"` or `"<item> Target Santa Monica"` / Best Buy / Apple / Costco / etc.
2. Prefer `fetch_url` on concrete public store locator or product pages from those results. Do not invent page contents if fetch fails or is truncated.
3. Report: store name, neighborhood or rough distance when known, and whether stock looks **confirmed** vs **unclear**.
4. Offer Amazon **and** local options together when helpful.
5. Do not claim guaranteed shelf stock from a vague search snippet — say when it is uncertain and share the link so they can verify.

## Notes

- Home area for local checks: **Santa Monica, CA** (and nearby West LA).
- Todos with URLs render as markdown links on `todos/list.md` and keep `url=` in the HTML meta comment.
- The board seeds this file automatically when the wiki is configured (or via **Add skill to wiki** in AI Tools). Do not hand-copy unless you are editing offline.
- Prefer this wiki page when present; the board also injects a built-in copy of this skill.
