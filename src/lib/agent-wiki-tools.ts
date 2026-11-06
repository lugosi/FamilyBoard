import type { AgentTool, AgentToolContext } from "./agent";
import { SKILLS_FOLDER, WIKI_CATEGORIES } from "./wiki-format";
import {
  createWikiPage,
  deleteWikiPage,
  editWikiSection,
  moveWikiPage,
  readWikiPage,
  rewriteWikiPage,
  saveSkill,
  searchWiki,
  WikiError,
} from "./wikilm-github";

const MAX_READ_CHARS = 30_000;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

function strList(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.trim()) return v.split(",");
  return undefined;
}

function readKey(path: string): string {
  return path.replace(/^\/+/, "").replace(/\.md$/i, "").toLowerCase();
}

function rememberRead(ctx: AgentToolContext, path: string, sha: string | undefined) {
  if (sha) ctx.wikiReads.set(readKey(path), { path, sha });
}

const pageCategories = WIKI_CATEGORIES.filter((c) => c.id !== SKILLS_FOLDER);
const categoryIds = WIKI_CATEGORIES.map((c) => c.id);

export const wikiTools: AgentTool[] = [
  {
    declaration: {
      name: "search_wiki",
      description:
        "Full-text search of the family wiki (titles, tags, headings, and page text). Use when the index doesn't make the right page obvious.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords, e.g. 'Maya shoe size'" },
          category: { type: "string", enum: categoryIds, description: "Optional folder filter" },
        },
        required: ["query"],
      },
    },
    async run(args) {
      const query = str(args.query) ?? "";
      const results = await searchWiki(query, { category: str(args.category), limit: 8 });
      return {
        response: {
          results: results.map(({ path, title, summary, tags, snippet }) => ({
            path,
            title,
            summary,
            tags,
            snippet,
          })),
        },
        label: `Searched the wiki for “${query}” (${results.length})`,
      };
    },
  },
  {
    declaration: {
      name: "read_wiki_page",
      description: "Read one wiki page's full markdown. Do this before answering from a page or rewriting it.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Page path from the index, e.g. people/maya.md" } },
        required: ["path"],
      },
    },
    async run(args, ctx) {
      const page = await readWikiPage(str(args.path) ?? "");
      rememberRead(ctx, page.path, page.sha);
      const content =
        page.body.length > MAX_READ_CHARS ? `${page.body.slice(0, MAX_READ_CHARS)}\n…(truncated)` : page.body;
      return {
        response: {
          path: page.path,
          title: page.title,
          summary: page.summary,
          tags: page.tags,
          updated: page.updated ?? null,
          sections: page.headings,
          content,
        },
        label: `Read wiki page “${page.title}”`,
      };
    },
  },
  {
    declaration: {
      name: "create_wiki_page",
      description:
        "Create a new wiki page. Only when no existing page covers the topic; otherwise use edit_wiki_section. Fails if the page already exists.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: pageCategories.map((c) => c.id),
            description: pageCategories.map((c) => `${c.id}: ${c.hint}`).join("; "),
          },
          title: { type: "string", description: "Short page title, e.g. 'Maya' or 'Wi-Fi'" },
          summary: { type: "string", description: "One line describing what the page holds" },
          tags: { type: "array", items: { type: "string" }, description: "2-5 lowercase tags" },
          body: {
            type: "string",
            description: "Markdown body organized under ## section headings. No frontmatter or # title.",
          },
        },
        required: ["category", "title", "summary", "body"],
      },
    },
    async run(args, ctx) {
      const page = await createWikiPage({
        category: str(args.category),
        title: str(args.title) ?? "",
        summary: str(args.summary),
        tags: strList(args.tags),
        body: typeof args.body === "string" ? args.body : "",
      });
      rememberRead(ctx, page.path, page.sha);
      return {
        response: { path: page.path, title: page.title },
        label: `Created wiki page “${page.title}” (${page.path})`,
      };
    },
  },
  {
    declaration: {
      name: "edit_wiki_section",
      description:
        "Safely add to or correct one section of an existing page without touching the rest. mode 'append' adds text at the end of the section (creating the section if missing); 'replace' swaps that section's content. Omit section to append at the end of the page.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Page path from the index" },
          section: { type: "string", description: "Section heading, e.g. 'Sizes'" },
          text: { type: "string", description: "Markdown to add or the section's new content (no heading)" },
          mode: { type: "string", enum: ["append", "replace"] },
        },
        required: ["path", "text", "mode"],
      },
    },
    async run(args, ctx) {
      const mode = str(args.mode) === "replace" ? "replace" : "append";
      const { page, created, heading } = await editWikiSection({
        path: str(args.path) ?? "",
        section: str(args.section),
        text: typeof args.text === "string" ? args.text : "",
        mode,
      });
      rememberRead(ctx, page.path, page.sha);
      const where = heading ? `“${heading}”` : "the end";
      return {
        response: { path: page.path, title: page.title, section: heading, createdSection: created },
        label: created
          ? `Added section “${heading}” to “${page.title}”`
          : mode === "replace"
            ? `Updated ${where} in “${page.title}”`
            : `Added to ${where} in “${page.title}”`,
      };
    },
  },
  {
    declaration: {
      name: "rewrite_wiki_page",
      description:
        "Replace a whole page (body and/or title, summary, tags) to restructure it. Requires read_wiki_page on that page earlier in this request; the full new body must keep everything worth keeping.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          body: { type: "string", description: "Complete new markdown body (no frontmatter)" },
          title: { type: "string" },
          summary: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["path"],
      },
    },
    async run(args, ctx) {
      const path = str(args.path) ?? "";
      const read = ctx.wikiReads.get(readKey(path));
      if (!read) {
        throw new WikiError("invalid", "Call read_wiki_page on this page first, then rewrite it");
      }
      const page = await rewriteWikiPage({
        path: read.path,
        expectedSha: read.sha,
        body: typeof args.body === "string" && args.body.trim() ? args.body : undefined,
        meta: { title: str(args.title), summary: str(args.summary), tags: strList(args.tags) },
      });
      rememberRead(ctx, page.path, page.sha);
      return { response: { path: page.path, title: page.title }, label: `Rewrote wiki page “${page.title}”` };
    },
  },
  {
    declaration: {
      name: "save_skill",
      description:
        "Save what was done in this conversation as a reusable skill (skills/ folder) so it can be rerun next time with new data. Only when someone asks to save it as a skill or agrees when you offer.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short action name, e.g. 'Soccer schedule to calendar'" },
          whenToUse: {
            type: "string",
            description: "One or two sentences: what request or input should trigger this skill",
          },
          inputs: {
            type: "string",
            description:
              "Markdown describing what the skill needs: file or Google Sheet link, its columns and what each means, example row",
          },
          steps: {
            type: "array",
            items: { type: "string" },
            description:
              "Ordered, generic steps naming the tools to call and the rules agreed in the conversation (calendar, title format, durations, duplicate checks, what to ask). No one-off values from this run.",
          },
          notes: { type: "string", description: "Gotchas, edge cases, and preferences" },
          tags: { type: "array", items: { type: "string" } },
          replaceExisting: {
            type: "boolean",
            description: "True only after the user confirmed replacing an existing skill with the same name",
          },
        },
        required: ["name", "whenToUse", "steps"],
      },
    },
    async run(args, ctx) {
      const { page, replaced } = await saveSkill({
        name: str(args.name) ?? "",
        whenToUse: str(args.whenToUse) ?? "",
        inputs: str(args.inputs),
        steps: strList(args.steps) ?? [],
        notes: str(args.notes),
        tags: strList(args.tags),
        replaceExisting: args.replaceExisting === true || args.replaceExisting === "true",
      });
      rememberRead(ctx, page.path, page.sha);
      return {
        response: { path: page.path, name: page.title, replaced },
        label: `${replaced ? "Updated" : "Saved"} skill “${page.title}”`,
      };
    },
  },
  {
    declaration: {
      name: "move_wiki_page",
      description: "Rename or move a page to another folder. Only when the user asks to move, rename, or reorganize.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          newPath: { type: "string", description: "e.g. people/maya.md" },
        },
        required: ["path", "newPath"],
      },
    },
    async run(args, ctx) {
      const page = await moveWikiPage({ path: str(args.path) ?? "", newPath: str(args.newPath) ?? "" });
      rememberRead(ctx, page.path, page.sha);
      return { response: { path: page.path, title: page.title }, label: `Moved “${page.title}” to ${page.path}` };
    },
  },
  {
    declaration: {
      name: "delete_wiki_page",
      description: "Delete a wiki page. Only when the user explicitly asked to delete that page.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    async run(args) {
      const page = await deleteWikiPage({ path: str(args.path) ?? "" });
      return { response: { deleted: page.path }, label: `Deleted wiki page “${page.title}”` };
    },
  },
];
