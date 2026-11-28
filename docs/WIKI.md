# Family wiki

The assistant's long-term memory is a folder of markdown files in a **private GitHub repo**. Browse and edit it on the AI tab (**Wiki** view), or just tell the assistant things ("remember that…", "what's Maya's shoe size?") on the board or in Slack.

## Setup

| Env var | Value |
|---------|-------|
| `WIKILM_GITHUB_TOKEN` | **Required.** Fine-grained PAT on `lugosi/family-wiki`, **Contents: Read and write** |
| `WIKILM_GITHUB_REPO` | Optional, default `lugosi/family-wiki` |
| `WIKILM_GITHUB_BRANCH` | Optional; defaults to the repo’s default branch (usually `main`) |
| `WIKILM_GITHUB_PATH` | Optional folder inside the repo, default `wiki` (use `.` for repo root) |

Every save is a normal commit (`wiki: add people/maya.md`), so history, diffs, and undo live in GitHub. Deleted pages stay in git history.

### If writes return 404

GitHub’s Contents API often answers **404** when the token can’t see the repo (not when the file is missing). Checklist:

1. Create the private repo **`lugosi/family-wiki`** on GitHub if it does not exist yet (empty is fine — FamilyBoard seeds the first commit).
2. Fine-grained PAT includes that repo — **Only select repositories** → `family-wiki` (or “All repositories”).
3. Permission **Contents: Read and write** (Metadata read alone is not enough).
4. On TrueNAS, set only `WIKILM_GITHUB_TOKEN`, pull `ghcr.io/lugosi/familyboard:latest`, and restart the app.
5. Leave `WIKILM_GITHUB_BRANCH` unset unless you intentionally use a non-default branch.

## Layout

One page per person or topic, in a folder:

| Folder | For |
|--------|-----|
| `people/` | Family members, friends, contacts: birthdays, sizes, allergies, preferences |
| `house/` | Wi-Fi, utilities, appliances, maintenance, warranties, where things are |
| `recipes/` | Family recipes and meal ideas |
| `school/` | Schools, teachers, class schedules, activities, portals |
| `health/` | Doctors, dentists, medications, insurance, vaccinations |
| `travel/` | Trips, packing lists, documents, loyalty numbers |
| `notes/` | Anything else |
| `todos/` | Open family tasks — especially `todos/list.md` (inbox scan + assistant keep this checklist current) |
| `.context/` | Hidden Slack continuity folders (`.context/<SlackUserId>/…`). Not listed in the board Wiki browser. Still in the shared repo, not private from whoever holds the wiki token |

Pages directly under the wiki folder still work (shown as **Unfiled**); ask the assistant to file them, or use **Move**. Subfolders up to three levels deep are fine (`school/maya/soccer.md`).

### Hidden `.context/` folders (Slack continuity)

When someone DMs the bot, FamilyBoard seeds `.context/<SlackUserId>/` (profile, open-loops, pets, Strava when linked). The Slack assistant gets an **index** of those pages each turn and should `read_wiki_page` matching ones so chats still feel continuous after Slack’s short memory expires. Create/edit writes inside the speaker's **own** `.context/<theirId>/` apply **silently** (no Approve) for **any** durable topic (hike prep, trips, work, pets, prefs) — default `open-loops.md`, or create a topic page (`travel.md`, `work.md`, …) when detail warrants it. Not only when someone says “remember”. Silent writes fall back to Approve when the message has a photo/file or the turn used `fetch_url` / `search_web` / `scan_inbox` / `read_google_sheet`, and move/delete/rewrite under `.context/` always need Approve. The assistant (`search_wiki`, `read_wiki_page`) and `/api/wiki/page` can read only the speaker's own folder. Shared family wiki pages still need Approve. Link people pages with `slack: U…` when useful. Still shared-repo storage — not private; Layer B personal GitHub later.

**Facts** (under `## Facts`) use dated, weighted lines so prefs don’t go stale unnoticed:

```markdown
- Prefers miles · created: 2026-01-15 · updated: 2026-03-01 · weight: 3
```

- `created` / `updated`: YYYY-MM-DD (page frontmatter also has `created` + `updated`)
- `weight` 1–5: bump by 1 when the same preference recurs (importance)
- Fresh for **30 × weight** days after `updated` (weight 1 ≈ 30 days; weight 5 ≈ 150 days). Stale facts are listed in the Slack index but must be confirmed or dropped before use.

## Page template

```markdown
---
title: Maya
summary: Maya's sizes, school, and allergies
tags: [kids, school]
slack: U012ABCDEF
updated: 2026-11-06
---

# Maya

## Sizes

- Shoes: 3
- Shirt: 10

## Allergies

Peanuts (EpiPen in the blue bag).
```

- **summary** is what the assistant sees in its index, so make it say what's on the page. Pages without frontmatter fall back to their first paragraph.
- **tags** help search. **updated** is stamped automatically on every save.
- **slack** (optional, on `people/` pages): Slack member id (`U…`) so Scheduled checks can DM that person. Find it in Slack → profile → ⋯ → Copy member ID.
- Use `##` sections: the assistant adds facts under the matching section ("Sizes") instead of rewriting the page.
- Link pages with relative links, e.g. `[school](../school/washington-elementary.md)`; they open inside the Wiki view.
- Other frontmatter keys are kept as-is.

## How the assistant uses it

- Its instructions include an **index** (path, title, summary, tags per page), not page contents, so the wiki can grow without crowding the prompt. It calls `search_wiki` / `read_wiki_page` to answer.
- To remember something it adds to the right section of an existing page (`edit_wiki_section`), or creates a page from the template (`create_wiki_page`). It won't create a near-duplicate of an existing page in the same folder.
- Whole-page rewrites (`rewrite_wiki_page`) require reading the page first in the same request and fail if the page changed in the meantime. Moves and deletes happen only when asked.
- Edits in the Wiki view are checked the same way: saving a page someone else changed since you opened it shows **Reload latest** instead of overwriting.

### Starter skills (optional)

Reusable how-tos live under `skills/` in the wiki.

- When the wiki is configured, FamilyBoard **auto-creates** `skills/shopping-lists.md` if it is missing (never overwrites). Covers Black Friday / shopping list adds with an Amazon link offer, plus local retail checks near Santa Monica, CA. Template: [`docs/wiki-skills/shopping-lists.md`](wiki-skills/shopping-lists.md). A built-in copy is always injected into the assistant; tap **Add skill to wiki** under AI → Tools → Todos when you want the wiki page explicitly.
- When **Strava** and the wiki are both configured, FamilyBoard **auto-creates** `skills/strava-training.md` if it is missing (never overwrites an existing page). You can also tap **Add skill to wiki** under AI → Tools → Strava. Template source: [`docs/wiki-skills/strava-training.md`](wiki-skills/strava-training.md). A built-in copy is also injected into the assistant when Strava is configured.

The repo is private, but anything you store is readable by whoever holds the token and by the assistant (Gemini). Think twice before storing things like full card numbers.
