<?php

declare(strict_types=1);

namespace Flex\Composer;

use Flex\Extension\V1\{BootablePluginInterface, EventNames, ExtensionEventInterface, PageEvent, PluginContext, PluginInterface, UninstallablePluginInterface, UpdatablePluginInterface};
use Flex\Pages\Page;

final class ComposerPlugin implements PluginInterface, BootablePluginInterface, UpdatablePluginInterface, UninstallablePluginInterface
{
    public function install(PluginContext $context): void
    {
        (new ComposerStore())->install();
    }

    public function activate(PluginContext $context): void
    {
        $this->install($context);
    }

    public function update(PluginContext $context, string $fromVersion): void
    {
        $this->install($context);
    }

    public function deactivate(PluginContext $context): void {}

    public function uninstall(PluginContext $context): void
    {
        (new ComposerStore())->uninstall();
    }

    public function boot(PluginContext $context): void
    {
        $this->associateExistingPages();
        foreach (ComposerStore::TYPES as $type) {
            $context->routes?->admin(['GET', 'PUT'], '/documents/' . $type . '/{id:number}', AdminController::class, 'document-' . $type);
            $context->routes?->admin('POST', '/documents/' . $type . '/{id:number}/restore', AdminController::class, 'restore-' . $type);
        }
        $context->routes?->admin(['GET', 'PUT'], '/settings', AdminController::class, 'settings');

        // The editor is a separate admin screen per record type, left out of the sidebar: the actions menu of
        // the pages and products lists opens it at /extension-pages/flex-composer-{type}/{id}/edit.
        $context->admin?->page('page', 'Composer', 'assets/admin.js', false, ['group' => 'content', 'icon' => 'file-text', 'hidden' => true]);
        $context->admin?->page('product', 'Composer', 'assets/admin.js', false, ['group' => 'commerce', 'icon' => 'file-text', 'hidden' => true]);
        $context->admin?->extend('pages.list', 'table.row-action', 'open-page', 'assets/admin.js', ['export' => 'createPageAction']);
        $context->admin?->extend('commerce.products.list', 'table.row-action', 'open-product', 'assets/admin.js', ['export' => 'createProductAction']);
        // "Отвори в Composer" stays available in the pages list; keep the in-section link only for products.
        $context->admin?->extend('commerce.product.editor.basic', 'section.end', 'editor-link-product', 'assets/admin.js', ['export' => 'createEditorLink']);

        $context->api->listen(EventNames::PAGE_DELETED, static function (ExtensionEventInterface $event): void {
            if ($event instanceof PageEvent && is_int($event->page['id'] ?? null)) {
                (new ComposerStore())->delete('page', $event->page['id']);
            }
        });
        $context->api->addAction('commerce.catalog.deleted', static function (array $deleted): void {
            if (($deleted['kind'] ?? null) === 'product' && is_int($deleted['id'] ?? null)) {
                (new ComposerStore())->delete('product', $deleted['id']);
            }
        });
    }

    /** Mark Composer documents created before pages exposed their active content editor. */
    private function associateExistingPages(): void
    {
        $pageIds = (new ComposerStore())->pageIds();
        if ($pageIds === []) {
            return;
        }
        foreach (Page::query()->whereIn('id', $pageIds)->get() as $page) {
            $settings = is_array($page->getAttribute('settings')) ? $page->getAttribute('settings') : [];
            if (isset($settings['content_builder']) && $settings['content_builder'] !== '') {
                continue;
            }
            $settings['content_builder'] = 'flex/composer';
            $page->setAttribute('settings', $settings);
            $page->saveOrFail();
        }
    }
}
