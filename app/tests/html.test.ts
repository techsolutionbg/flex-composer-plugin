// @vitest-environment jsdom
import { BlockNoteEditor } from "@blocknote/core"
import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { pageSchema, productSchema } from "../src/blocks"
import { cleanHtml, exportHtml, importHtml, signature } from "../src/html"

const pageEditor = () => BlockNoteEditor.create({ schema: pageSchema }) as never
const productEditor = () => BlockNoteEditor.create({ schema: productSchema }) as never
const body = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body

/** Import, then export: what a reader sees must be the same. */
function roundTrip(html: string, kind: "page" | "product" = "page") {
  const editor = kind === "page" ? pageEditor() : productEditor()
  const blocks = importHtml(editor, html, { embeds: kind === "page" })
  const output = exportHtml(editor, blocks as never)
  return { blocks, output }
}

function expectSameContent(html: string, kind: "page" | "product" = "page") {
  const { output, blocks } = roundTrip(html, kind)
  expect(signature(body(output))).toBe(signature(body(html)))
  return { output, blocks }
}

describe("importHtml and exportHtml", () => {
  it("keeps paragraphs, headings, formatting and links as blocks", () => {
    const html =
      '<h2>Заглавие</h2><p>Текст с <strong>удебелен</strong>, <em>курсив</em>, <u>подчертан</u>, <s>зачертан</s> и <a href="https://example.com">връзка</a>.</p><blockquote>Цитат</blockquote>'
    const { blocks } = expectSameContent(html)
    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "quote"])
  })

  it("turns a shortcode paragraph into an embed block and writes it back unchanged", () => {
    const html = '<p>[gallery id="5" design="slider"]</p><p>След галерията.</p>'
    const { blocks, output } = roundTrip(html)
    expect(blocks[0]).toEqual({ type: "embed", props: { code: '[gallery id="5" design="slider"]' } })
    expect(output.startsWith('<p>[gallery id="5" design="slider"]</p>')).toBe(true)
    expect(signature(body(output))).toBe(signature(body(html)))
  })

  it("keeps a shortcode as text in products, which have no embeds", () => {
    const { blocks } = roundTrip('<p>[gallery id="5"]</p>', "product")
    expect(blocks[0].type).toBe("paragraph")
  })

  it("rebuilds the flat lists of the classic editor, with nesting and check items", () => {
    const html =
      '<ol><li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>Едно</li><li data-list="bullet" class="ql-indent-1">Вложено</li><li data-list="bullet">Две</li></ol>' +
      '<ol><li data-list="ordered">Първо</li><li data-list="ordered">Второ</li></ol>' +
      '<ol><li data-list="checked">Готово</li><li data-list="unchecked">Предстои</li></ol>'
    const { blocks, output } = roundTrip(html)
    expect(blocks.map((block) => block.type)).toEqual([
      "bulletListItem",
      "bulletListItem",
      "numberedListItem",
      "numberedListItem",
      "checkListItem",
      "checkListItem",
    ])
    expect(blocks[0].children?.[0]?.type).toBe("bulletListItem")
    const out = body(output)
    expect(out.querySelectorAll("ul ul li").length).toBe(1)
    expect(out.querySelectorAll("ol > li").length).toBe(2)
    expect(out.querySelectorAll("input[type=checkbox]").length).toBe(2)
    expect(out.textContent).toContain("Вложено")
  })

  it("maps classic alignment classes to block alignment", () => {
    const { blocks, output } = roundTrip('<p class="ql-align-center">Център</p>')
    expect(blocks[0].props?.textAlignment).toBe("center")
    expect(body(output).querySelector("p")?.style.textAlign).toBe("center")
  })

  it("turns classic code blocks into a code block", () => {
    const html = '<div class="ql-code-block-container" spellcheck="false"><div class="ql-code-block">a = 1</div><div class="ql-code-block">b = 2</div></div>'
    const { blocks, output } = roundTrip(html)
    expect(blocks[0].type).toBe("codeBlock")
    expect(body(output).querySelector("pre")?.textContent).toBe("a = 1\nb = 2")
  })

  it("keeps markup the blocks cannot represent as HTML blocks, verbatim", () => {
    const html = '<div class="hero" data-x="1"><span>Блок</span></div><p style="color: red">Червено</p><iframe src="https://example.com/embed"></iframe><!-- бележка -->'
    const { blocks, output } = roundTrip(html)
    expect(blocks.map((block) => block.type)).toEqual(["html", "html", "html", "html"])
    expect(output).toBe(html)
  })

  it("keeps images with their address and text", () => {
    const html = '<p>Преди</p><img src="/media/2026/10/photo.jpg" alt="Снимка"><p>След</p>'
    const { blocks } = expectSameContent(html)
    expect(blocks.some((block) => block.type === "image" || block.type === "html")).toBe(true)
  })

  it("keeps tables", () => {
    const html = "<table><tbody><tr><th>Име</th><th>Цена</th></tr><tr><td>Чай</td><td>3 лв.</td></tr></tbody></table>"
    const { blocks } = expectSameContent(html)
    expect(blocks.map((block) => block.type)).toContain("table")
  })

  it("keeps tables in products as HTML, since product blocks have no tables", () => {
    const html = "<table><tbody><tr><td>Чай</td></tr></tbody></table>"
    const { blocks, output } = roundTrip(html, "product")
    expect(blocks[0].type).toBe("html")
    expect(output).toBe(html)
  })

  it("writes an empty document as empty HTML", () => {
    const editor = pageEditor()
    expect(exportHtml(editor, [{ type: "paragraph", props: {}, content: [], children: [] }] as never)).toBe("")
    expect(importHtml(editor, "", { embeds: true })).toEqual([])
  })

  it("is stable: a second import of its own output gives the same HTML", () => {
    const html = '<h2>А</h2><p>Б <a href="/kontakti">В</a></p><ul><li>Г</li><li>Д</li></ul><p>[gallery id="1"]</p><div class="x">Е</div>'
    const first = roundTrip(html).output
    expect(roundTrip(first).output).toBe(first)
  })

  // Optional: the local pages and products, exported from the development database (not committed).
  const fixture = `${process.cwd()}/tests/fixtures/local-records.json`
  it.skipIf(!existsSync(fixture))("keeps the content of the local pages and products", () => {
    const records = JSON.parse(readFileSync(fixture, "utf8")) as Record<"pages" | "products", { id: number; html: string | null }[] | null>
    for (const page of records.pages ?? []) expect(expectSameContent(page.html ?? "", "page").blocks.filter((block) => block.type === "html")).toEqual([])
    for (const product of records.products ?? []) expect(expectSameContent(product.html ?? "", "product").blocks.filter((block) => block.type === "html")).toEqual([])
  })
})

describe("cleanHtml", () => {
  it("drops BlockNote attributes and opens only external links in a new tab", () => {
    const html =
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow" classname="bn-inline-content-section" data-inline-content-type="link">А</a> <a href="/kontakti" target="_blank" rel="nofollow">Б</a></p><img src="/a.jpg" alt="В" data-name="В" data-url="/a.jpg">'
    expect(cleanHtml(html)).toBe('<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">А</a> <a href="/kontakti">Б</a></p><img src="/a.jpg" alt="В">')
  })
})

describe("documents written by Composer", () => {
  it("import again as the same blocks, without HTML blocks", () => {
    const editor = pageEditor()
    const html = exportHtml(editor, [
      { type: "table", content: { type: "tableContent", rows: [{ cells: ["Име", "Цена"] }, { cells: ["Чай", "3"] }] } },
      { type: "image", props: { url: "/a.jpg", name: "Снимка", caption: "Надпис" } },
      { type: "checkListItem", props: { checked: true }, content: "Готово" },
      { type: "codeBlock", props: { language: "javascript" }, content: "a = 1" },
      { type: "divider" },
      { type: "heading", props: { level: 4, textAlignment: "center" }, content: "Заглавие" },
      { type: "numberedListItem", content: "Едно", children: [{ type: "bulletListItem", content: "Вложено" }] },
      { type: "embed", props: { code: '[gallery id="2"]' } },
    ] as never)
    expect(html).not.toMatch(/bn-|data-(name|url|level|caption|checked|editable|inline)|classname|colspan="1"/)
    const blocks = importHtml(editor, html, { embeds: true })
    expect(blocks.filter((block) => block.type === "html")).toEqual([])
    expect(exportHtml(editor, blocks as never)).toBe(html)
  })
})
