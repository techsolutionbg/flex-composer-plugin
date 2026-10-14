<?php

declare(strict_types=1);

namespace Flex\Composer;

use Flex\Contracts\Http\ResponseFactoryInterface;
use Flex\Http\RequestInput;
use Flex\Pages\PageService;
use Psr\Http\Message\{ResponseInterface, ServerRequestInterface};

final readonly class AdminController
{
    public function __construct(private ResponseFactoryInterface $responses, private RequestInput $input, private PageService $pages) {}

    public function __invoke(ServerRequestInterface $request, array $arguments = []): ResponseInterface
    {
        $store = new ComposerStore();
        $records = new ComposerRecords($this->pages);
        $path = $request->getUri()->getPath();
        $method = $request->getMethod();
        try {
            if (str_ends_with($path, '/settings')) {
                $settings = $method === 'PUT' ? $store->saveSettings($this->body($request)) : $store->settings();

                return $this->json(['settings' => $settings]);
            }
            if (preg_match('~/documents/(page|product)/(\d+)(/restore)?$~', $path, $match) === 1) {
                $type = $match[1];
                $id = (int) $match[2];
                if (($match[3] ?? '') !== '') {
                    return $this->json($this->restore($store, $records, $type, $id));
                }
                if ($method === 'PUT') {
                    return $this->json($this->save($store, $records, $type, $id, $this->body($request)));
                }

                return $this->json($this->document($store, $records, $type, $id));
            }

            return $this->json(['error' => ['message' => 'Не е намерено.']], 404);
        } catch (\InvalidArgumentException $error) {
            $status = $error->getCode() >= 400 && $error->getCode() < 500 ? $error->getCode() : 422;

            return $this->json(['error' => ['message' => $error->getMessage()]], $status);
        }
    }

    /**
     * The record and its block document. state is "new" (never opened in Composer), "current" (the record still
     * has the HTML Composer wrote) or "changed" (edited elsewhere since; the editor imports the HTML again).
     * @return array<string, mixed>
     */
    public function document(ComposerStore $store, ComposerRecords $records, string $type, int $id): array
    {
        $record = $records->get($type, $id);
        $document = $store->get($type, $id);
        $hash = ComposerStore::hash($record['html']);
        $state = $document === null ? 'new' : ($document['html_hash'] === $hash ? 'current' : 'changed');

        return [
            'record' => $record + ['html_hash' => $hash],
            'document' => $state === 'current' ? $document['document'] : null,
            'state' => $state,
            'has_source' => $document['has_source'] ?? false,
            'version' => $document['version'] ?? 0,
        ];
    }

    /**
     * Saves the block document and writes its HTML to the record. base_hash is the hash of the record HTML the
     * editor started from; a different current hash means someone else saved meanwhile.
     * @param array<string, mixed> $body
     * @return array<string, mixed>
     */
    public function save(ComposerStore $store, ComposerRecords $records, string $type, int $id, array $body): array
    {
        $html = $body['html'] ?? null;
        if (!is_string($html) || strlen($html) > ComposerStore::MAX_DOCUMENT_BYTES) {
            throw new \InvalidArgumentException('Невалидно съдържание.', 422);
        }
        $record = $records->get($type, $id);
        $currentHash = ComposerStore::hash($record['html']);
        if (($body['force'] ?? false) !== true && ($body['base_hash'] ?? null) !== $currentHash) {
            throw new \InvalidArgumentException('Записът е променен на друго място, след като го отворихте. Презаредете или запишете върху промените.', 409);
        }
        $existing = $store->get($type, $id);
        // Even an unchanged HTML save selects Composer as the page's active content editor.
        $records->writeHtml($type, $id, $html);
        $written = $records->get($type, $id)['html'];
        $store->save($type, $id, $body['document'] ?? null, $written, $existing === null ? $record['html'] : null);

        return $this->document($store, $records, $type, $id);
    }

    /** Writes the HTML from before Composer back to the record and forgets the block document. @return array<string, mixed> */
    public function restore(ComposerStore $store, ComposerRecords $records, string $type, int $id): array
    {
        $source = $store->sourceHtml($type, $id);
        if ($source === null) {
            throw new \InvalidArgumentException('Няма запазен оригинал за възстановяване.', 404);
        }
        $records->writeHtml($type, $id, $source, PageService::BUILTIN_CONTENT_EDITOR);
        $store->delete($type, $id);

        return $this->document($store, $records, $type, $id);
    }

    /** @return array<string, mixed> */
    private function body(ServerRequestInterface $request): array
    {
        $body = $this->input->all($request);

        return is_array($body) ? $body : [];
    }

    /** @param array<string, mixed> $payload */
    private function json(array $payload, int $status = 200): ResponseInterface
    {
        return $this->responses->json($payload, $status, ['Cache-Control' => 'no-store']);
    }
}
