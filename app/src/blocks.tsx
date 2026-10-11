import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core"
import { createReactBlockSpec } from "@blocknote/react"
import { useEffect, useState } from "react"

/** A shortcode such as [gallery id="1"], kept as its own block so it is never split or reformatted. */
export const SHORTCODE = /^\[[a-z][a-z0-9_-]*(?:\s+[^\]\r\n]*)?\]$/

export const createEmbedBlock = createReactBlockSpec(
  { type: "embed", propSchema: { code: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const [code, setCode] = useState(block.props.code)
      useEffect(() => setCode(block.props.code), [block.props.code])
      const valid = SHORTCODE.test(code.trim())
      return (
        <div className="composer-card composer-embed" contentEditable={false}>
          <div className="composer-card-label">Вграждане</div>
          <input
            className="composer-card-input"
            aria-label="Код за вграждане"
            aria-invalid={!valid}
            value={code}
            readOnly={!editor.isEditable}
            placeholder='[gallery id="1"]'
            onChange={(event) => setCode(event.currentTarget.value)}
            onBlur={() => {
              if (code !== block.props.code) editor.updateBlock(block, { props: { code: code.trim() } })
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === "Enter") event.currentTarget.blur()
            }}
          />
          {!valid && <div className="composer-card-hint">Очаква се код във вида [име атрибут="стойност"].</div>}
        </div>
      )
    },
    toExternalHTML: ({ block }) => <p>{block.props.code}</p>,
  },
)

export const createHtmlBlock = createReactBlockSpec(
  { type: "html", propSchema: { html: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const [html, setHtml] = useState(block.props.html)
      const [preview, setPreview] = useState(false)
      useEffect(() => setHtml(block.props.html), [block.props.html])
      return (
        <div className="composer-card composer-html" contentEditable={false}>
          <div className="composer-card-head">
            <span className="composer-card-label">HTML код</span>
            <button type="button" className="composer-card-toggle" onClick={() => setPreview(!preview)}>
              {preview ? "Код" : "Преглед"}
            </button>
          </div>
          {preview ? (
            <iframe
              className="composer-html-preview"
              title="Преглед на HTML кода"
              sandbox=""
              srcDoc={`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui,sans-serif;margin:8px">${html}`}
            />
          ) : (
            <textarea
              className="composer-card-code"
              aria-label="HTML код"
              spellCheck={false}
              value={html}
              readOnly={!editor.isEditable}
              rows={Math.min(16, Math.max(3, html.split("\n").length + 1))}
              onChange={(event) => setHtml(event.currentTarget.value)}
              onBlur={() => {
                if (html !== block.props.html) editor.updateBlock(block, { props: { html } })
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
          )}
        </div>
      )
    },
    toExternalHTML: ({ block }) => <div dangerouslySetInnerHTML={{ __html: block.props.html }} />,
  },
)

const {
  paragraph,
  heading,
  quote,
  bulletListItem,
  numberedListItem,
  checkListItem,
  codeBlock,
  table,
  image,
  video,
  audio,
  file,
  divider,
} = defaultBlockSpecs

/** Pages render their HTML as stored, so they get every block. */
export const pageSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph,
    heading,
    quote,
    bulletListItem,
    numberedListItem,
    checkListItem,
    codeBlock,
    table,
    image,
    video,
    audio,
    file,
    divider,
    embed: createEmbedBlock(),
    html: createHtmlBlock(),
  },
})

/**
 * Flex Commerce cleans product descriptions to text, lists, quotes, code, links and images before showing them,
 * so the product editor offers only blocks that survive that. The HTML block is there only to keep imported
 * markup that the other blocks cannot represent; the menu does not offer it for products.
 */
export const productSchema = BlockNoteSchema.create({
  blockSpecs: { paragraph, heading, quote, bulletListItem, numberedListItem, codeBlock, image, html: createHtmlBlock() },
})

/** Block types the slash menu offers for products; pages are offered everything in their schema. */
export const productMenuTypes = ["paragraph", "heading", "quote", "bulletListItem", "numberedListItem", "codeBlock", "image"]

export type ComposerKind = "page" | "product"

export function schemaFor(kind: ComposerKind) {
  return kind === "product" ? productSchema : pageSchema
}

export function blockTypes(kind: ComposerKind): Set<string> {
  return new Set(Object.keys(schemaFor(kind).blockSpecs))
}
