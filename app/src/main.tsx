import "@blocknote/ariakit/style.css"
import "./styles.css"
import { createRef, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ComposerEditor, type ComposerHandle, type ComposerServices } from "./ComposerEditor"

export type { ComposerServices }

/**
 * Mounts the block editor into an element of the admin page. Composer carries its own React because the admin
 * shares only its React instance with plugins, not ReactDOM; the editor therefore lives in a separate root.
 */
export function mount(container: HTMLElement, services: ComposerServices) {
  const handle = createRef<ComposerHandle>()
  const root = createRoot(container)
  container.classList.add("composer-root")
  root.render(
    <StrictMode>
      <ComposerEditor ref={handle} services={services} />
    </StrictMode>,
  )
  return {
    getContent: () => {
      if (!handle.current) throw new Error("Редакторът още не е зареден.")
      return handle.current.getContent()
    },
    focus: () => handle.current?.focus(),
    unmount: () => {
      root.unmount()
      container.classList.remove("composer-root")
    },
  }
}
