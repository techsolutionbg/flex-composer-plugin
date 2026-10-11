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
  it("builds and reads editor paths", () => {
    expect(editorPath("page", 7)).toBe("/extension-pages/flex-composer-editor/page/7")
    expect(parsePath("/product/12")).toEqual({ type: "product", id: 12 })
    expect(parsePath("/extension-pages/flex-composer-editor/page/3")).toEqual({ type: "page", id: 3 })
    expect(parsePath("")).toBeNull()
    expect(parsePath("/page/0")).toBeNull()
    expect(parsePath("/post/3")).toBeNull()
  })
})

describe("row actions", () => {
  it("open the record in Composer and hide for deleted rows", () => {
    const navigate = vi.fn()
    const page = createPageAction()
    expect(page.label).toBe("Отвори в Composer")
    page.onSelect({ id: 4 }, { navigate })
    expect(navigate).toHaveBeenCalledWith("/extension-pages/flex-composer-editor/page/4")
    const product = createProductAction()
    product.onSelect({ id: 9 }, { navigate })
    expect(navigate).toHaveBeenLastCalledWith("/extension-pages/flex-composer-editor/product/9")
    expect(product.visible({ id: 9, deleted_at: "2026-10-01T00:00:00Z" })).toBe(false)
    expect(product.visible({ id: 9, deleted_at: null })).toBe(true)
  })
})

function host(request: (url: string, method?: string, body?: unknown) => Promise<unknown>) {
  const Pass = ({ children }: { children?: React.ReactNode }) => createElement("div", null, children)
  const Button = ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => createElement("button", props, children)
  return {
    React,
    request,
    toast: { success: vi.fn(), error: vi.fn() },
    time: { parse: () => null },
    useWorkspaceChanged: () => vi.fn(),
    useWorkspaceSaved: () => vi.fn(),
    components: {
      Breadcrumbs: () => null,
      Button,
      LoadingButton: ({ loading: _loading, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => Button(props),
      ConfirmDialog: ({ open, title }: { open: boolean; title: string }) => (open ? createElement("div", { role: "dialog" }, title) : null),
      MediaPicker: () => null,
      DateTime: ({ value }: { value: string }) => value,
      Input: (props: Record<string, unknown>) => createElement("input", props),
      DataTable: ({ data, columns, toolbar }: { data: Record<string, unknown>[]; columns: { key: string; render?: (row: unknown) => React.ReactNode }[]; toolbar?: React.ReactNode }) =>
        createElement(Pass, null, toolbar, ...data.map((row, index) => createElement("div", { key: index, className: "row" }, ...columns.map((column) => createElement("span", { key: column.key }, column.render ? column.render(row) : String(row[column.key] ?? "")))))),
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
  it("lists records to open and switches to products when Flex Commerce is active", async () => {
    const request = vi.fn(async (url: string) => ({
      types: ["page", "product"],
      records: url.includes("type=product") ? [{ id: 9, title: "Чай", status: "active", updated_at: null }] : [{ id: 1, title: "За нас", status: "published", updated_at: null }],
    }))
    const Page = createPage(host(request))
    const navigate = vi.fn()
    const { container, root } = await render(createElement(Page, { path: "", navigate }))
    expect(request).toHaveBeenCalledWith(BASE + "/records?type=page&q=", "GET", undefined, expect.any(AbortSignal))
    expect(container.textContent).toContain("За нас")
    expect(container.querySelector("link[rel=stylesheet]")?.getAttribute("href")).toMatch(/composer\.css$/)
    const products = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Продукти")!
    await act(async () => products.click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
    expect(container.textContent).toContain("Чай")
    const open = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Чай")!
    open.click()
    expect(navigate).toHaveBeenCalledWith("/extension-pages/flex-composer-editor/product/9")
    root.unmount()
  })

  it("shows the record and an import notice for a record never opened in Composer", async () => {
    const request = vi.fn(async () => ({
      record: { id: 1, type: "page", title: "За нас", status: "published", html: "<p>Текст</p>", url: "/za-nas", html_hash: "x" },
      document: null,
      state: "new",
      has_source: false,
      version: 0,
    }))
    const Page = createPage(host(request))
    const { container, root } = await render(createElement(Page, { path: "/page/1", navigate: vi.fn() }))
    expect(request).toHaveBeenCalledWith(BASE + "/documents/page/1", "GET", undefined, expect.any(AbortSignal))
    expect(container.querySelector("h1")?.textContent).toBe("За нас")
    expect(container.textContent).toContain("Нищо не се записва, докато не натиснете „Запази“.")
    const save = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Записано")!
    expect(save.disabled).toBe(true)
    expect(container.querySelector("a[href='/za-nas']")).not.toBeNull()
    root.unmount()
  })

  it("shows a load failure with a retry", async () => {
    const request = vi.fn(async () => {
      throw new Error("Страницата не е намерена.")
    })
    const Page = createPage(host(request))
    const { container, root } = await render(createElement(Page, { path: "/page/404", navigate: vi.fn() }))
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Страницата не е намерена.")
    expect(container.textContent).toContain("Опитай отново")
    root.unmount()
  })
})
