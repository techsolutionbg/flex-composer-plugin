import { BlockNoteEditor } from "@blocknote/core"
import { FilePanelExtension, filterSuggestionItems } from "@blocknote/core/extensions"
import { BlockNoteView } from "@blocknote/ariakit"
import {
  EmbedTab,
  FilePanel,
  type FilePanelProps,
  FilePanelController,
  type DefaultReactSuggestionItem,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  useExtension,
} from "@blocknote/react"
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { type ComposerKind, productMenuTypes, schemaFor } from "./blocks"
import { exportHtml, importHtml } from "./html"
import { bg } from "./locale-bg"

export type MediaKind = "image" | "video" | "audio" | "file"
export type PickedMedia = { url: string; name?: string; alt?: string }

export type ComposerServices = {
  kind: ComposerKind
  /** The block document saved earlier, or null to import the record HTML. */
  document: unknown[] | null
  html: string
  pickMedia: (kind: MediaKind) => Promise<PickedMedia | null>
  onChange: () => void
}

export type ComposerHandle = {
  getContent: () => { document: unknown[]; html: string }
  focus: () => void
}

const PRODUCT_MENU = new Set(["paragraph", "heading", "heading_2", "heading_3", "heading_4", "heading_5", "heading_6", "quote", "numbered_list", "bullet_list", "code_block", "image"])

/** The admin theme is set on <html>; the editor follows it, including later changes from the profile. */
function useAdminTheme(): "light" | "dark" {
  const read = (): "light" | "dark" => (document.documentElement.dataset.adminTheme === "dark" ? "dark" : "light")
  const [theme, setTheme] = useState(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-admin-theme"] })
    return () => observer.disconnect()
  }, [])
  return theme
}

function MediaTab({ blockId, pickMedia }: FilePanelProps & { pickMedia: ComposerServices["pickMedia"] }) {
  const Components = useComponentsContext()!
  const editor = useBlockNoteEditor()
  const filePanel = useExtension(FilePanelExtension)
  const block = editor.getBlock(blockId)
  if (!block) return null
  const kind = (["image", "video", "audio"].includes(block.type) ? block.type : "file") as MediaKind
  return (
    <Components.FilePanel.TabPanel className="bn-tab-panel">
      <Components.FilePanel.Button
        className="bn-button"
        type="button"
        onClick={() => void (async () => {
          const media = await pickMedia(kind)
          if (!media || !editor.getBlock(blockId)) return
          editor.updateBlock(blockId, { props: { url: media.url, name: media.alt || media.name || "" } } as never)
          filePanel.closeMenu()
        })()}
      >
        Избери от медийната библиотека
      </Components.FilePanel.Button>
    </Components.FilePanel.TabPanel>
  )
}

export const ComposerEditor = forwardRef<ComposerHandle, { services: ComposerServices }>(function ComposerEditor({ services }, ref) {
  const theme = useAdminTheme()
  const schema = schemaFor(services.kind)
  const ready = useRef(false)
  // The document is read once, with a detached editor of the same schema; later changes come from the editor.
  const initial = useMemo(() => {
    const blocks = services.document ?? importHtml(BlockNoteEditor.create({ schema }) as never, services.html, { embeds: services.kind === "page" })
    return blocks.length ? blocks : undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const editor = useCreateBlockNote({
    schema,
    dictionary: bg,
    initialContent: initial as never,
    tables: { headers: true, splitCells: services.kind === "page", cellBackgroundColor: false, cellTextColor: false },
    animations: false,
  })

  // Loading the document is not an edit; only changes after it mark the screen as changed.
  useEffect(() => {
    const timer = window.setTimeout(() => (ready.current = true), 0)
    return () => window.clearTimeout(timer)
  }, [editor])

  useImperativeHandle(
    ref,
    () => ({
      getContent: () => {
        const document = editor.document as unknown[]
        return { document, html: exportHtml(editor as never, document as never) }
      },
      focus: () => editor.focus(),
    }),
    [editor],
  )

  const items = (query: string) => {
    const defaults = getDefaultReactSlashMenuItems(editor).filter((item) => {
      const key = (item as DefaultReactSuggestionItem & { key?: string }).key ?? ""
      if (key === "emoji" || key.startsWith("toggle_")) return false
      return services.kind === "page" || PRODUCT_MENU.has(key)
    })
    const extra: DefaultReactSuggestionItem[] =
      services.kind === "page"
        ? [
            {
              title: "Вграждане",
              subtext: "Код на разширение, например галерия",
              aliases: ["embed", "shortcode", "галерия", "вграждане"],
              group: "Разширени",
              onItemClick: () => insertAfterCursor({ type: "embed", props: { code: "" } }),
            },
            {
              title: "HTML код",
              subtext: "HTML, който се записва точно както е въведен",
              aliases: ["html", "код", "raw"],
              group: "Разширени",
              onItemClick: () => insertAfterCursor({ type: "html", props: { html: "" } }),
            },
          ]
        : []
    return Promise.resolve(filterSuggestionItems([...defaults, ...extra], query))
  }

  function insertAfterCursor(block: { type: string; props: Record<string, string> }) {
    const current = editor.getTextCursorPosition().block
    const empty = Array.isArray(current.content) && current.content.length === 0
    if (empty) editor.replaceBlocks([current], [block as never])
    else editor.insertBlocks([block as never], current, "after")
  }

  return (
    <BlockNoteView
      editor={editor}
      theme={theme}
      className="composer-view"
      slashMenu={false}
      emojiPicker={false}
      filePanel={false}
      onChange={() => {
        if (ready.current) services.onChange()
      }}
    >
      <SuggestionMenuController triggerCharacter="/" getItems={items} />
      <FilePanelController
        filePanel={(props) => (
          <FilePanel
            {...props}
            tabs={[
              { name: "Медия", tabPanel: <MediaTab {...props} pickMedia={services.pickMedia} /> },
              { name: bg.file_panel.embed.title, tabPanel: <EmbedTab {...props} /> },
            ]}
          />
        )}
      />
    </BlockNoteView>
  )
})
