# Family wiki

The assistant's long-term memory is a folder of markdown files in a **private GitHub repo**. Browse and edit it on the AI tab (**Wiki** view), or just tell the assistant things ("remember that…", "what's Maya's shoe size?") on the board or in Slack.

## Setup

| Env var | Value |
|---------|-------|
| `WIKILM_GITHUB_REPO` | `owner/repo` of a private repo |
| `WIKILM_GITHUB_TOKEN` | Fine-grained token, that repo only, **Contents: Read and write** |
| `WIKILM_GITHUB_BRANCH` | Optional, default `main` |
| `WIKILM_GITHUB_PATH` | Optional folder inside the repo, default `wiki` |

Every save is a normal commit (`wiki: add people/maya.md`), so history, diffs, and undo live in GitHub. Deleted pages stay in git history.

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

Pages directly under the wiki folder still work (shown as **Unfiled**); ask the assistant to file them, or use **Move**. Subfolders up to three levels deep are fine (`school/maya/soccer.md`).

## Page template

```markdown
---
title: Maya
summary: Maya's sizes, school, and allergies
tags: [kids, school]
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
- Use `##` sections: the assistant adds facts under the matching section ("Sizes") instead of rewriting the page.
- Link pages with relative links, e.g. `[school](../school/washington-elementary.md)`; they open inside the Wiki view.
- Other frontmatter keys are kept as-is.

## How the assistant uses it

- Its instructions include an **index** (path, title, summary, tags per page), not page contents, so the wiki can grow without crowding the prompt. It calls `search_wiki` / `read_wiki_page` to answer.
- To remember something it adds to the right section of an existing page (`edit_wiki_section`), or creates a page from the template (`create_wiki_page`). It won't create a near-duplicate of an existing page in the same folder.
- Whole-page rewrites (`rewrite_wiki_page`) require reading the page first in the same request and fail if the page changed in the meantime. Moves and deletes happen only when asked.
- Edits in the Wiki view are checked the same way: saving a page someone else changed since you opened it shows **Reload latest** instead of overwriting.

The repo is private, but anything you store is readable by whoever holds the token and by the assistant (Gemini). Think twice before storing things like full card numbers.
