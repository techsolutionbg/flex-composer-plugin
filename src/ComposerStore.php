<?php

declare(strict_types=1);

namespace Flex\Composer;

use Flex\Extension\V1\Time;
use Illuminate\Database\{Connection, Eloquent\Model, Schema\Blueprint};

/**
 * The block document of a page or product. The BlockNote JSON is the source for Composer; the generated HTML is
 * written to the record itself, and its hash tells whether the record was changed elsewhere since.
 */
final class ComposerStore
{
    public const TYPES = ['page', 'product'];
    public const MAX_DOCUMENT_BYTES = 2_000_000;

    private Connection $db;

    public function __construct(?Connection $db = null)
    {
        $this->db = $db ?? Model::resolveConnection();
    }

    public function install(): void
    {
        $schema = $this->db->getSchemaBuilder();
        if (!$schema->hasTable('flex_composer_documents')) {
            $schema->create('flex_composer_documents', static function (Blueprint $t): void {
                $t->increments('id');
                $t->string('object_type', 16);
                $t->unsignedInteger('object_id');
                $t->longText('document');
                $t->char('html_hash', 64);
                // The record's HTML before Composer first saved it, so the original can be restored exactly.
                $t->longText('source_html')->nullable();
                $t->unsignedInteger('version')->default(1);
                $t->timestamp('updated_at')->nullable();
                $t->unique(['object_type', 'object_id']);
            });
        }
        if (!$schema->hasTable('flex_composer_settings')) {
            $schema->create('flex_composer_settings', static function (Blueprint $t): void {
                $t->integer('id')->primary();
                $t->text('values');
            });
            $this->db->table('flex_composer_settings')->insert(['id' => 1, 'values' => '{}']);
        }
    }

    public function uninstall(): void
    {
        if (!$this->db->getSchemaBuilder()->hasTable('flex_composer_settings') || !$this->settings()['delete_on_uninstall']) {
            return;
        }
        $this->db->getSchemaBuilder()->dropIfExists('flex_composer_documents');
        $this->db->getSchemaBuilder()->dropIfExists('flex_composer_settings');
    }

    /** @return array{delete_on_uninstall: bool} */
    public function settings(): array
    {
        $raw = $this->db->table('flex_composer_settings')->where('id', 1)->value('values');
        $values = json_decode(is_string($raw) ? $raw : '{}', true);

        return ['delete_on_uninstall' => is_array($values) && ($values['delete_on_uninstall'] ?? false) === true];
    }

    /** @param array<string, mixed> $input @return array{delete_on_uninstall: bool} */
    public function saveSettings(array $input): array
    {
        if (array_key_exists('delete_on_uninstall', $input) && !is_bool($input['delete_on_uninstall'])) {
            throw new \InvalidArgumentException('Невалидна настройка.', 422);
        }
        $values = ['delete_on_uninstall' => ($input['delete_on_uninstall'] ?? $this->settings()['delete_on_uninstall']) === true];
        $this->db->table('flex_composer_settings')->where('id', 1)->update(['values' => json_encode($values, JSON_THROW_ON_ERROR)]);

        return $values;
    }

    /** @return array{document: list<mixed>, html_hash: string, has_source: bool, version: int, updated_at: string|null}|null */
    public function get(string $type, int $id): ?array
    {
        $this->assertType($type);
        $row = $this->db->table('flex_composer_documents')->where('object_type', $type)->where('object_id', $id)->first();
        if ($row === null) {
            return null;
        }
        $document = json_decode((string) $row->document, true);

        return [
            'document' => is_array($document) ? $document : [],
            'html_hash' => (string) $row->html_hash,
            'has_source' => $row->source_html !== null,
            'version' => (int) $row->version,
            'updated_at' => Time::iso($row->updated_at),
        ];
    }

    /** The record's HTML from before Composer was first used on it, or null. */
    public function sourceHtml(string $type, int $id): ?string
    {
        $this->assertType($type);
        $value = $this->db->table('flex_composer_documents')->where('object_type', $type)->where('object_id', $id)->value('source_html');

        return is_string($value) ? $value : null;
    }

    /**
     * @param mixed $document The BlockNote document (a list of blocks).
     * @param string $html The HTML generated from it and written to the record.
     * @param string|null $sourceHtml The record's HTML before the first save; kept only the first time.
     */
    public function save(string $type, int $id, mixed $document, string $html, ?string $sourceHtml = null): array
    {
        $this->assertType($type);
        if ($id < 1) {
            throw new \InvalidArgumentException('Невалиден запис.', 422);
        }
        self::assertDocument($document);
        $encoded = json_encode($document, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        if (strlen($encoded) > self::MAX_DOCUMENT_BYTES) {
            throw new \InvalidArgumentException('Документът е твърде голям.', 422);
        }
        $existing = $this->db->table('flex_composer_documents')->where('object_type', $type)->where('object_id', $id)->first();
        $values = [
            'document' => $encoded,
            'html_hash' => self::hash($html),
            'updated_at' => Time::now(),
        ];
        if ($existing === null) {
            $this->db->table('flex_composer_documents')->insert($values + [
                'object_type' => $type,
                'object_id' => $id,
                'source_html' => $sourceHtml,
                'version' => 1,
            ]);
        } else {
            $this->db->table('flex_composer_documents')->where('id', $existing->id)->update($values + ['version' => (int) $existing->version + 1]);
        }

        return $this->get($type, $id) ?? throw new \RuntimeException('Документът не беше записан.');
    }

    public function delete(string $type, int $id): void
    {
        $this->assertType($type);
        $this->db->table('flex_composer_documents')->where('object_type', $type)->where('object_id', $id)->delete();
    }

    /** Hash of record HTML, normalized for line endings so a CRLF round trip is not a change. */
    public static function hash(string $html): string
    {
        return hash('sha256', str_replace("\r\n", "\n", $html));
    }

    /** A BlockNote document is a list of blocks with an id and a type. */
    private static function assertDocument(mixed $document): void
    {
        if (!is_array($document) || !array_is_list($document) || count($document) > 5000) {
            throw new \InvalidArgumentException('Невалиден документ.', 422);
        }
        foreach ($document as $block) {
            if (!is_array($block) || !is_string($block['type'] ?? null) || preg_match('/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/', $block['type']) !== 1) {
                throw new \InvalidArgumentException('Невалиден блок в документа.', 422);
            }
        }
    }

    private function assertType(string $type): void
    {
        if (!in_array($type, self::TYPES, true)) {
            throw new \InvalidArgumentException('Невалиден тип.', 422);
        }
    }
}
