# Flex Composer

A block-based visual editor for Flex CMS, built on [BlockNote](https://www.blocknotejs.org/). It edits existing pages and Flex Commerce products on a separate screen, alongside the classic editor, which stays as it is.

Version: **0.1.0** · ID: `flex/composer` · Minimum Flex CMS version: **0.1.61**.

GitHub repository: `techsolutionbg/flex-composer-plugin`.

## Requirements and installation

Requires an installed Flex CMS 0.1.61 or later with PHP 8.3+ and its database. Version 0.1.60 adds the admin extension points that Composer uses for its row actions, and 0.1.61 admin pages hidden from the sidebar. **Flex Commerce** is optional: when it is active, products can be edited as well.

Place the package in `plugins/flex/composer/`, with `plugin.json` directly inside that folder. From the Flex CMS root:

```sh
php bin/flex plugin:install flex/composer
php bin/flex plugin:activate flex/composer
```

With Docker, prefix the commands with `docker compose exec app`. Installation, activation and updates create the `flex_composer_documents` and `flex_composer_settings` tables when they are missing. The plugin requests the `admin.ui`, `events.listen`, `routes.admin` and `frontend.assets` permissions.

Deactivating the plugin removes the Composer screen and the row actions. The content of pages and products stays as Composer last saved it, as ordinary HTML, so the site and the classic editor keep working. Uninstalling keeps the block documents unless `delete_on_uninstall` is set in the settings (see the API below).

## How it is used

- **Отвори в Composer** in the **Действия** (actions) menu of every page in the pages list and every product in the Flex Commerce products list opens the editor for that record, at `/extension-pages/flex-composer-page/{id}/edit` or `/extension-pages/flex-composer-product/{id}/edit`.
- Composer has no entry in the admin sidebar; its screens are registered as hidden admin pages.
- New pages and products are still created on their usual screens; Composer edits records that already exist.

The editor screen has **Запази** (also Ctrl+S / ⌘S), **Класически редактор** to open the record's usual edit screen, and **Виж на сайта** for published records. Leaving with unsaved changes asks for confirmation, as on the other admin screens.

## Blocks

| Block | Pages | Products |
| --- | :---: | :---: |
| Paragraph, headings 1–6, quote | ✓ | ✓ |
| Bulleted and numbered lists, with nesting | ✓ | ✓ |
| Check list | ✓ | |
| Code | ✓ | ✓ |
| Image (from the media library or by address) | ✓ | ✓ |
| Video, audio, file | ✓ | |
| Table (header rows and columns, merged cells) | ✓ | |
| Divider | ✓ | |
| **Вграждане** – a shortcode such as `[gallery id="1"]` | ✓ | |
| **HTML код** – markup kept exactly as written | ✓ | imported only |

Blocks are added with `/` or the `+` button and moved by dragging the handle beside them. Text can be bold, italic, underlined, struck through, inline code, coloured and linked; blocks can be aligned. Products get only the blocks that Flex Commerce keeps when it cleans product descriptions for the storefront.

The editor follows the admin theme, light or dark, and switches with it.

## Content and compatibility

The record's own field stays the source for the site: page content (`pages.content`) and product description. Composer keeps the block document (BlockNote JSON) next to it and writes the HTML generated from it into the record through the platform's page service and the Flex Commerce catalogue, so their validation, events and other plugins work as usual.

- **First opening.** The record HTML is converted to blocks. Each top-level element is converted, converted back and compared (text, links, images, formatting, alignment); anything that would change becomes an **HTML код** block holding the original markup verbatim. Lists, alignment and code blocks of the classic editor are recognised. Nothing is written until **Запази**.
- **Later openings** load the saved blocks, unless the record was changed elsewhere since (for example in the classic editor). Then the current HTML is converted again and a notice says so.
- **Conflicts.** If the record changes elsewhere while it is open in Composer, saving stops and offers to overwrite.
- **Restore.** The HTML from before the first Composer save is kept. **Възстанови съдържанието отпреди Composer** writes it back and forgets the block document.
- **Links** to other sites open in a new tab (`target="_blank"`, `rel="noopener noreferrer"`); links within the site open in the same tab. No link is marked `nofollow`.

Composer adds a small public stylesheet, `assets/content.css`, only for markup it writes that themes rarely style: check lists, images with captions and tables.

Deleting a page or product deletes its block document.

## Admin API

All routes are under `/admin/plugins/flex/composer` and require an admin session (with CSRF protection for changes).

| Method and path | Purpose |
| --- | --- |
| `GET /documents/{type}/{id}` | The record, its HTML hash, the block document and its state (`new`, `current`, `changed`) |
| `PUT /documents/{type}/{id}` | Save `{document, html, base_hash, force?}`; `409` when the record changed since `base_hash` |
| `POST /documents/{type}/{id}/restore` | Write back the HTML from before Composer |
| `GET\|PUT /settings` | `{delete_on_uninstall: bool}` |

## Development

The editor is a separate React application in `app/`, bundled with its own React and BlockNote into `assets/composer.js` and `assets/composer.css` (the admin shares only its React instance with plugins, not ReactDOM). `assets/admin.js` is the plugin's admin module: the record list, the editor screen and the row actions. The built files are committed; `app/` is not part of release packages.

```sh
cd app
npm install
npm run build   # type check and build into ../assets
npm test        # HTML conversion and admin module tests (Vitest, jsdom)
```

From the Flex CMS root, the PHP tests run with:

```sh
vendor/bin/phpunit plugins/flex/composer/tests
```

To check the conversion against real content, export the local pages and products to `app/tests/fixtures/local-records.json` as `{"pages": [{"id", "html"}], "products": [...]}`; the test is skipped when the file is missing, and the file is not committed.

## License

This plugin is licensed under the GNU General Public License, version 2 or (at your option) any later version (`GPL-2.0-or-later`). The full text of version 2 is in [`LICENSE`](LICENSE). BlockNote is licensed under MPL-2.0 (the packages used here contain no paid XL features).
