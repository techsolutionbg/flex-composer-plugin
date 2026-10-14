<?php

declare(strict_types=1);

namespace Flex\Composer;

use Flex\Extension\V1\Time;
use Flex\Extensions\{Plugin, PluginManager};
use Flex\Pages\{Page, PageRepository, PageService};
use Flex\Pages\Exception\{PageNotFound, PageValidationFailed};

/**
 * Pages and Flex Commerce products that Composer edits. Reads go to the owners' data; writes go through
 * PageService and the Commerce catalogue, so their validation, events and other plugins keep working.
 */
final class ComposerRecords
{
    private ?bool $commerceActive = null;

    public function __construct(private PageService $pages, private ?PageRepository $repository = null)
    {
        $this->repository ??= new PageRepository();
    }

    public function commerceActive(): bool
    {
        if ($this->commerceActive === null) {
            try {
                $plugin = Plugin::query()->find('flex/commerce');
                $this->commerceActive = $plugin instanceof Plugin
                    && $plugin->getAttribute('status') === PluginManager::STATUS_ACTIVE
                    && class_exists(\Flex\Commerce\CatalogStore::class);
            } catch (\Throwable) {
                $this->commerceActive = false;
            }
        }

        return $this->commerceActive;
    }

    /** @return array{id: int, type: string, title: string, status: string, html: string, url: string|null, updated_at: string|null} */
    public function get(string $type, int $id): array
    {
        $this->assertAvailable($type);
        if ($type === 'page') {
            $page = $this->repository->find($id);
            if (!$page instanceof Page) {
                throw new \InvalidArgumentException('Страницата не е намерена.', 404);
            }
            $path = $this->repository->publicPageSet()->publicPath($page);

            return [
                'id' => $id,
                'type' => 'page',
                'title' => (string) $page->getAttribute('title'),
                'status' => (string) $page->getAttribute('status'),
                'html' => (string) ($page->getAttribute('content') ?? ''),
                'url' => $page->getAttribute('status') === 'published' ? '/' . ltrim($path, '/') : null,
                'updated_at' => Time::iso($page->getAttribute('updated_at')),
            ];
        }
        $product = $this->product($id);

        return [
            'id' => $id,
            'type' => 'product',
            'title' => (string) $product['name'],
            'status' => (string) $product['status'],
            'html' => (string) ($product['description'] ?? ''),
            'url' => $product['status'] === 'active' ? '/product/' . rawurlencode((string) $product['slug']) : null,
            'updated_at' => Time::iso($product['updated_at'] ?? null),
        ];
    }

    /** Writes new HTML to the record through its owner. */
    public function writeHtml(string $type, int $id, string $html, ?string $contentBuilder = 'flex/composer'): void
    {
        $this->assertAvailable($type);
        if ($type === 'page') {
            $page = $this->repository->find($id);
            if (!$page instanceof Page) {
                throw new \InvalidArgumentException('Страницата не е намерена.', 404);
            }
            try {
                $this->pages->update($id, [
                    'title' => (string) $page->getAttribute('title'),
                    'slug' => (string) $page->getAttribute('slug'),
                    'content' => $html,
                    // PageService replaces every field it validates, so the legacy block list goes back unchanged.
                    'blocks' => is_array($page->getAttribute('blocks')) ? $page->getAttribute('blocks') : [],
                    'status' => (string) $page->getAttribute('status'),
                    'parent_id' => $page->getAttribute('parent_id'),
                    'featured_media_id' => $page->getAttribute('featured_media_id'),
                    'content_builder' => $contentBuilder,
                ]);
            } catch (PageValidationFailed $error) {
                throw new \InvalidArgumentException($error->getMessage(), 422);
            } catch (PageNotFound) {
                throw new \InvalidArgumentException('Страницата не е намерена.', 404);
            }

            return;
        }
        $store = new \Flex\Commerce\CatalogStore();
        $product = $this->product($id);
        $product['description'] = $html;
        try {
            $store->save('products', $product, $id);
        } catch (\Flex\Commerce\CommerceException $error) {
            throw new \InvalidArgumentException($error->getMessage(), $error->getCode() >= 400 && $error->getCode() < 500 ? $error->getCode() : 422);
        }
    }

    /** @return array<string, mixed> */
    private function product(int $id): array
    {
        try {
            $product = (new \Flex\Commerce\CatalogStore())->get('products', $id);
        } catch (\Flex\Commerce\CommerceException) {
            throw new \InvalidArgumentException('Продуктът не е намерен.', 404);
        }
        if (($product['deleted_at'] ?? null) !== null) {
            throw new \InvalidArgumentException('Продуктът е в кошчето.', 409);
        }

        return $product;
    }

    private function assertAvailable(string $type): void
    {
        if (!in_array($type, ComposerStore::TYPES, true)) {
            throw new \InvalidArgumentException('Невалиден тип.', 422);
        }
        if ($type === 'product' && !$this->commerceActive()) {
            throw new \InvalidArgumentException('Flex Commerce не е активен.', 409);
        }
    }
}
