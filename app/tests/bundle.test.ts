// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

describe("assets/composer.js", () => {
  it("mounts the built editor, imports the record HTML and returns it unchanged", async () => {
    // @ts-expect-error The built bundle has no types.
    const { mount } = await import("../../assets/composer.js")
    const container = document.createElement("div")
    document.body.append(container)
    const onChange = vi.fn()
    const html = '<h2>Заглавие</h2><p>Текст с <a href="/kontakti">връзка</a>.</p><p>[gallery id="1"]</p>'
    const editor = mount(container, { kind: "page", document: null, html, pickMedia: async () => null, onChange })
    // BlockNote renders React blocks in a later task.
    for (let wait = 0; wait < 40 && !container.querySelector(".composer-embed"); wait++) await new Promise((resolve) => setTimeout(resolve, 50))
    expect(container.classList.contains("composer-root")).toBe(true)
    expect(container.querySelector(".bn-editor")).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>(".composer-embed input")?.value).toBe('[gallery id="1"]')
    const content = editor.getContent()
    expect(content.html).toBe(html)
    expect(content.document.map((block: { type: string }) => block.type)).toEqual(["heading", "paragraph", "embed"])
    expect(onChange).not.toHaveBeenCalled()
    editor.unmount()
    expect(container.innerHTML).toBe("")
  })
})
