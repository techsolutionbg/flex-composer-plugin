// @vitest-environment jsdom
import { act, createElement } from "react"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
// @ts-expect-error The admin module is plain JavaScript without types.
import { BASE, createPage, createPageAction, createProductAction, editorPath, parsePath } from "../../assets/admin.js"

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("paths", () => {
  it("builds and reads editor paths that the admin workspace accepts", () => {
    expect(editorPath("page", 7)).toBe("/extension-pages/flex-composer-page/7/edit")
    expect(editorPath("product", 12)).toBe("/extension-pages/flex-composer-product/12/edit")
    expect(parsePath("/extension-pages/flex-composer-product/12/edit")).toEqual({ type: "product", id: 12 })
    expect(parsePath("/extension-pages/flex-composer-page/3/edit")).toEqual({ type: "page", id: 3 })
    expect(parsePath("/extension-pages/flex-composer-page")).toBeNull()
    expect(parsePath("/extension-pages/flex-composer-page/0/edit")).toBeNull()
    expect(parsePath("/extension-pages/flex-composer-post/3/edit")).toBeNull()
    // The same rule as isWorkspacePath in the admin (lib/workspace-storage.ts).
    for (const path of [editorPath("page", 7), editorPath("product", 12)]) expect(path).toMatch(/^\/extension-pages\/[a-z][a-z0-9_-]*(?:\/(?:create|\d+\/edit))?$/)
  })
})

describe("row actions", () => {
  it("open the record in Composer and hide for deleted rows", () => {
    const navigate = vi.fn()
    const page = createPageAction()
    expect(page.label).toBe("Отвори в Composer")
    page.onSelect({ id: 4 }, { navigate })
    expect(navigate).toHaveBeenCalledWith("/extension-pages/flex-composer-page/4/edit")
    const product = createProductAction()
    product.onSelect({ id: 9 }, { navigate })
    expect(navigate).toHaveBeenLastCalledWith("/extension-pages/flex-composer-product/9/edit")
    expect(product.visible({ id: 9, deleted_at: "2026-10-01T00:00:00Z" })).toBe(false)
    expect(product.visible({ id: 9, deleted_at: null })).toBe(true)
  })
})

function host(request: (url: string, method?: string, body?: unknown) => Promise<unknown>) {
  const Button = ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => createElement("button", props, children)
  return {
    React,
    request,
    toast: { success: vi.fn(), error: vi.fn() },
    time: { parse: () => null },
    useWorkspaceChanged: () => vi.fn(),
    useWorkspaceSaved: () => vi.fn(),
    usePageHelp: vi.fn(),
    components: {
      Breadcrumbs: () => null,
      Button,
      LoadingButton: ({ loading: _loading, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => Button(props),
      ConfirmDialog: ({ open, title }: { open: boolean; title: string }) => (open ? createElement("div", { role: "dialog" }, title) : null),
      MediaPicker: () => null,
      Hint: ({ children }: { children?: React.ReactNode }) => createElement("div", { role: "note" }, children),
    },
  }
}

async function render(element: React.ReactElement) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
  return { container, root }
}

describe("createPage", () => {
  it("shows the record and an import notice for a record never opened in Composer", async () => {
    const request = vi.fn(async () => ({
      record: { id: 1, type: "page", title: "За нас", status: "published", html: "<p>Текст</p>", url: "/za-nas", html_hash: "x" },
      document: null,
      state: "new",
      has_source: false,
      version: 0,
    }))
    const Page = createPage(host(request))
    const { container, root } = await render(createElement(Page, { path: "/extension-pages/flex-composer-page/1/edit", navigate: vi.fn() }))
    expect(request).toHaveBeenCalledWith(BASE + "/documents/page/1", "GET", undefined, expect.any(AbortSignal))
    expect(container.querySelector("h1")?.textContent).toBe("За нас")
    expect(container.textContent).toContain("Нищо не се записва, докато не натиснете „Запази“.")
    const save = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Записано")!
    expect(save.disabled).toBe(true)
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Виж на сайта")).toBe(true)
    root.unmount()
  })

  it("shows a load failure with a retry", async () => {
    const request = vi.fn(async () => {
      throw new Error("Страницата не е намерена.")
    })
    const Page = createPage(host(request))
    const { container, root } = await render(createElement(Page, { path: "/extension-pages/flex-composer-page/404/edit", navigate: vi.fn() }))
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Страницата не е намерена.")
    expect(container.textContent).toContain("Опитай отново")
    root.unmount()
  })
})

describe("createPage without a record", () => {
  it("points to the actions menus instead of listing records", async () => {
    const request = vi.fn()
    const navigate = vi.fn()
    const Page = createPage(host(request))
    const { container, root } = await render(createElement(Page, { path: "/extension-pages/flex-composer-page", navigate }))
    expect(request).not.toHaveBeenCalled()
    expect(container.textContent).toContain("„Отвори в Composer“")
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Към страниците")!.click()
    expect(navigate).toHaveBeenCalledWith("/pages")
    root.unmount()
  })
})

describe("createEditorLink", () => {
  it("opens saved pages and products in Composer from the classic editors", async () => {
    const { createEditorLink } = await import("../../assets/admin.js" as string)
    const Link = createEditorLink(host(vi.fn()))
    const navigate = vi.fn()
    const { container, root } = await render(createElement(Link, { context: { type: "product", id: 9 }, navigate }))
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Отвори в Composer")!.click()
    expect(navigate).toHaveBeenCalledWith("/extension-pages/flex-composer-product/9/edit")
    root.unmount()
    for (const context of [{ type: "page", id: null }, { type: "category", id: 3 }]) {
      const empty = await render(createElement(Link, { context, navigate }))
      expect(empty.container.innerHTML).toBe("")
      empty.root.unmount()
    }
  })
})

describe("guidance", () => {
  it("describes the blocks each kind of record has", async () => {
    const { guidance } = await import("../../assets/admin.js" as string)
    const text = (type: string) => JSON.stringify(guidance(createElement, type))
    expect(text("page")).toContain("Вграждане")
    expect(text("product")).not.toContain("Вграждане")
    expect(text("product")).toContain("Продуктите имат само блокове")
  })
})
