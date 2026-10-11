import { SHORTCODE } from "./blocks"

/** The part of the BlockNote editor the conversion needs; tests pass a real editor without a view. */
export interface HtmlEditor {
  tryParseHTMLToBlocks(html: string): unknown[]
  blocksToHTMLLossy(blocks: never[]): string
}

type Block = { type: string; props?: Record<string, unknown>; children?: Block[] }

const TOP_LEVEL = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "BLOCKQUOTE", "PRE", "TABLE", "HR", "IMG", "FIGURE", "VIDEO", "AUDIO"])
const INNER = new Set([
  ...TOP_LEVEL,
  "A", "STRONG", "B", "EM", "I", "U", "S", "STRIKE", "DEL", "CODE", "BR", "SPAN", "LI", "INPUT",
  "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "COLGROUP", "COL", "FIGCAPTION", "SOURCE",
])
const ATTRIBUTES = new Set(["href", "target", "rel", "src", "alt", "title", "width", "height", "colspan", "rowspan", "style", "type", "checked", "start", "controls", "spellcheck", "class", "data-language"])
/** Tags whose number must survive a round trip; wrappers BlockNote adds or drops (p, span, tbody…) are left out. */
const COUNTED: Record<string, string> = {
  STRONG: "strong", B: "strong", EM: "em", I: "em", U: "u", S: "s", STRIKE: "s", DEL: "s", CODE: "code",
  A: "a", IMG: "img", TABLE: "table", TR: "tr", TD: "cell", TH: "cell", LI: "li", UL: "ul", OL: "ol",
  BLOCKQUOTE: "blockquote", PRE: "pre", HR: "hr", H1: "h1", H2: "h2", H3: "h3", H4: "h4", H5: "h5", H6: "h6",
  SUB: "sub", SUP: "sup", VIDEO: "video", AUDIO: "audio", INPUT: "input",
}

function parse(html: string): HTMLElement {
  return new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html").body
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/**
 * Rewrites the markup of the classic (Quill 2) editor into plain HTML: its lists are flat <ol> elements with
 * data-list and ql-indent-N, its code blocks are divs and its alignment is a class.
 */
export function normalizeQuill(root: HTMLElement): void {
  root.querySelectorAll(".ql-ui, .ql-cursor").forEach((element) => element.remove())
  root.querySelectorAll<HTMLElement>("[class*='ql-align-']").forEach((element) => {
    const align = Array.from(element.classList).find((name) => name.startsWith("ql-align-"))!
    element.style.textAlign = align.slice("ql-align-".length)
    element.classList.remove(align)
    if (element.classList.length === 0) element.removeAttribute("class")
  })
  root.querySelectorAll(".ql-code-block-container").forEach((container) => {
    const pre = container.ownerDocument.createElement("pre")
    const code = container.ownerDocument.createElement("code")
    code.textContent = Array.from(container.querySelectorAll(".ql-code-block"), (line) => line.textContent ?? "").join("\n")
    const language = container.querySelector(".ql-code-block")?.getAttribute("data-language")
    if (language && language !== "plain") pre.setAttribute("data-language", language)
    pre.append(code)
    container.replaceWith(pre)
  })
  root.querySelectorAll("ol, ul").forEach((list) => {
    if (!list.isConnected || !list.querySelector(":scope > li[data-list]")) return
    list.replaceWith(rebuildQuillList(list))
  })
}

function rebuildQuillList(list: Element): DocumentFragment {
  const document = list.ownerDocument
  const fragment = document.createDocumentFragment()
  const stack: { level: number; kind: string; list: HTMLElement }[] = []
  for (const item of Array.from(list.children)) {
    const type = item.getAttribute("data-list") ?? "bullet"
    const kind = type === "ordered" ? "ordered" : type === "checked" || type === "unchecked" ? "check" : "bullet"
    const indent = Array.from(item.classList).find((name) => /^ql-indent-\d+$/.test(name))
    const level = indent ? Number(indent.slice("ql-indent-".length)) : 0
    const li = document.createElement("li")
    li.innerHTML = item.innerHTML
    const align = (item as HTMLElement).style?.textAlign
    if (align) li.style.textAlign = align
    if (kind === "check") {
      const box = document.createElement("input")
      box.type = "checkbox"
      if (type === "checked") box.setAttribute("checked", "")
      li.prepend(box)
    }
    while (stack.length && (stack.at(-1)!.level > level || (stack.at(-1)!.level === level && stack.at(-1)!.kind !== kind))) stack.pop()
    let current = stack.at(-1)
    if (!current || current.level < level) {
      const element = document.createElement(kind === "ordered" ? "ol" : "ul")
      const parentItem = current?.list.lastElementChild
      if (parentItem) parentItem.append(element)
      else fragment.append(element)
      current = { level, kind, list: element }
      stack.push(current)
    }
    current.list.append(li)
  }
  return fragment
}

/** Whether an element uses only markup the block editor can represent. */
function representable(element: Element): boolean {
  if (!TOP_LEVEL.has(element.tagName)) return false
  for (const node of [element, ...Array.from(element.querySelectorAll("*"))]) {
    if (!INNER.has(node.tagName)) return false
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase()
      if (!ATTRIBUTES.has(name)) return false
      if (name === "class" && !(node.tagName === "PRE" && attribute.value.trim() === "ql-syntax") && !(node.tagName === "CODE" && /^language-[a-z0-9_+-]+$/i.test(attribute.value.trim()))) return false
      if (name === "style" && !/^\s*text-align\s*:\s*(left|center|right|justify)\s*;?\s*$/i.test(attribute.value)) return false
      if (name === "type" && !(node.tagName === "INPUT" && attribute.value === "checkbox")) return false
      if (/^\s*javascript:/i.test(attribute.value)) return false
    }
  }
  return true
}

const BREAKING = /^(P|H[1-6]|LI|TD|TH|TR|PRE|BLOCKQUOTE|DIV|FIGURE|FIGCAPTION|BR|UL|OL|TABLE)$/

/** The text of an element, with blocks separated by a space so markup between blocks does not matter. */
function textOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ""
  const inner = Array.from(node.childNodes, textOf).join("")
  return node instanceof Element && BREAKING.test(node.tagName) ? ` ${inner} ` : inner
}

/** What a reader would notice if it changed: the text, links, images, formatting and alignment. */
export function signature(root: Element): string {
  const counts: Record<string, number> = {}
  const links: string[] = []
  const media: string[] = []
  const aligns: string[] = []
  for (const node of Array.from(root.querySelectorAll("*"))) {
    const key = COUNTED[node.tagName]
    if (key) counts[key] = (counts[key] ?? 0) + 1
    // Where a link opens is decided on export (see cleanHtml), so only its address counts.
    if (node.tagName === "A") links.push(node.getAttribute("href") ?? "")
    if (node.tagName === "IMG" || node.tagName === "VIDEO" || node.tagName === "AUDIO" || node.tagName === "SOURCE")
      media.push(`${node.getAttribute("src") ?? ""}|${node.getAttribute("alt") ?? ""}`)
    if (node.tagName === "INPUT") media.push(`checkbox|${node.hasAttribute("checked")}`)
    const align = (node as HTMLElement).style?.textAlign
    if (align && align !== "left") aligns.push(align)
  }
  const text = textOf(root).replace(/[\s ]+/g, " ").trim()
  return JSON.stringify([text, Object.entries(counts).sort(), links, media, aligns])
}

function wrap(html: string): Element {
  return parse(html)
}

function shortcodeOf(node: ChildNode): string | null {
  const text = (node.textContent ?? "").trim()
  if (!SHORTCODE.test(text)) return null
  if (node.nodeType === Node.TEXT_NODE) return text
  if (node instanceof Element && node.tagName === "P" && !node.querySelector(":not(br)") && node.attributes.length === 0) return text
  return null
}

/**
 * Turns record HTML into blocks. Markup the editor represents goes through BlockNote's parser; every element is
 * checked by converting it back, and anything that would change becomes an HTML block holding it verbatim.
 */
export function importHtml(editor: HtmlEditor, html: string, options: { embeds: boolean }): Block[] {
  const root = parse(html)
  normalizeQuill(root)
  const blocks: Block[] = []
  let run: string[] = []
  const flush = () => {
    if (run.length) blocks.push(...(editor.tryParseHTMLToBlocks(run.join("")) as Block[]))
    run = []
  }
  const keep = (markup: string) => {
    flush()
    blocks.push({ type: "html", props: { html: markup } })
  }
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.COMMENT_NODE) {
      keep(`<!--${(node as Comment).data}-->`)
      continue
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ""
      if (text.trim() === "") continue
      const code = options.embeds ? shortcodeOf(node) : null
      if (code) {
        flush()
        blocks.push({ type: "embed", props: { code } })
      } else run.push(`<p>${escapeText(text.trim())}</p>`)
      continue
    }
    if (!(node instanceof Element)) continue
    const code = options.embeds ? shortcodeOf(node) : null
    if (code) {
      flush()
      blocks.push({ type: "embed", props: { code } })
      continue
    }
    if (!representable(node) || !roundTrips(editor, node)) {
      keep(node.outerHTML)
      continue
    }
    run.push(node.outerHTML)
  }
  flush()
  return blocks
}

function roundTrips(editor: HtmlEditor, element: Element): boolean {
  try {
    const blocks = editor.tryParseHTMLToBlocks(element.outerHTML) as Block[]
    if (blocks.some((block) => block.type === "html" || block.type === "embed")) return false
    return signature(wrap(element.outerHTML)) === signature(wrap(editor.blocksToHTMLLossy(blocks as never[])))
  } catch {
    return false
  }
}

/** Editor-only attributes: "classname" and every data-* attribute except the code language. */
function internalAttribute(name: string): boolean {
  return name === "classname" || (name.startsWith("data-") && name !== "data-language")
}

/**
 * Removes BlockNote's own attributes from its HTML. BlockNote opens every link in a new tab and marks it nofollow;
 * here only links to other sites open in a new tab, and none is marked nofollow.
 */
export function cleanHtml(html: string): string {
  const root = parse(html)
  root.querySelectorAll("*").forEach((element) => {
    for (const { name } of Array.from(element.attributes)) if (internalAttribute(name)) element.removeAttribute(name)
    for (const name of ["colspan", "rowspan"]) if (element.getAttribute(name) === "1") element.removeAttribute(name)
    const classes = Array.from(element.classList).filter((name) => !name.startsWith("bn-"))
    if (classes.length) element.setAttribute("class", classes.join(" "))
    else element.removeAttribute("class")
  })
  root.querySelectorAll("a[href]").forEach((link) => {
    if (/^https?:\/\//i.test(link.getAttribute("href") ?? "")) {
      link.setAttribute("target", "_blank")
      link.setAttribute("rel", "noopener noreferrer")
    } else {
      link.removeAttribute("target")
      link.removeAttribute("rel")
    }
  })
  // An empty block comes out as an object replacement character, which is never content.
  return root.innerHTML.replace(/￼/g, "")
}

/** The record HTML for a document: BlockNote's HTML for its blocks, embeds as their code and HTML blocks verbatim. */
export function exportHtml(editor: HtmlEditor, blocks: Block[]): string {
  const parts: string[] = []
  let run: Block[] = []
  const flush = () => {
    if (run.length) parts.push(cleanHtml(editor.blocksToHTMLLossy(run as never[])))
    run = []
  }
  for (const block of blocks) {
    if (block.type === "embed") {
      flush()
      const code = String(block.props?.code ?? "").trim()
      if (code) parts.push(`<p>${escapeText(code)}</p>`)
    } else if (block.type === "html") {
      flush()
      const markup = String(block.props?.html ?? "")
      if (markup.trim()) parts.push(markup)
    } else run.push(block)
  }
  flush()
  return parts.join("").replace(/(?:<p[^>]*>\s*(?:<br\s*\/?>)?\s*<\/p>)+$/i, "")
}
