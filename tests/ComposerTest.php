<?php

declare(strict_types=1);

namespace Flex\Composer\Tests;

use Flex\Composer\{AdminController, ComposerRecords, ComposerStore};
use Flex\Configuration\ConfigurationRepository;
use Flex\Contracts\Http\ResponseFactoryInterface;
use Flex\Database\DatabaseManager;
use Flex\Extensions\ExtensionApi;
use Flex\Http\RequestInput;
use Flex\Pages\{PageRepository, PageService};
use Illuminate\Database\Connection;
use Illuminate\Database\Schema\Blueprint;
use PHPUnit\Framework\TestCase;

foreach (['ComposerStore', 'ComposerRecords', 'AdminController'] as $class) {
    require_once __DIR__ . '/../src/' . $class . '.php';
}

final class ComposerTest extends TestCase
{
    private const ORIGINAL = '<p>Добре дошли.</p><p>[gallery id="1"]</p>';

    private DatabaseManager $database;
    private Connection $db;
    private ComposerStore $store;
    private ComposerRecords $records;
    private AdminController $controller;

    protected function setUp(): void
    {
        $this->database = new DatabaseManager(new ConfigurationRepository(['database' => ['default' => 'sqlite', 'connections' => ['sqlite' => ['driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '']]]]));
        $this->database->schema()->create('pages', static function (Blueprint $t): void {
            $t->increments('id');
            $t->unsignedBigInteger('author_id')->nullable();
            $t->unsignedInteger('parent_id')->nullable();
            $t->unsignedInteger('featured_media_id')->nullable();
            $t->string('title', 190);
            $t->string('slug', 190)->unique();
            $t->text('content')->nullable();
            $t->string('status', 20)->default('draft');
            $t->timestamp('published_at')->nullable();
            $t->json('settings')->nullable();
            $t->text('blocks')->nullable();
            $t->timestamps();
            $t->softDeletes();
        });
        $this->db = $this->database->connection();
        $now = '2026-10-01 10:00:00';
        $this->db->table('pages')->insert([
            ['id' => 1, 'title' => 'Начало', 'slug' => 'home', 'content' => self::ORIGINAL, 'status' => 'published', 'blocks' => '[{"type":"paragraph","data":{"text":"Стар блок"}}]', 'created_at' => $now, 'updated_at' => $now],
            ['id' => 2, 'title' => 'Чернова', 'slug' => 'draft', 'content' => '', 'status' => 'draft', 'blocks' => null, 'created_at' => $now, 'updated_at' => $now],
        ]);
        $this->store = new ComposerStore($this->db);
        $this->store->install();
        $this->store->install();
        $pages = new PageService(new PageRepository(), new ExtensionApi());
        $this->records = new ComposerRecords($pages);
        $this->controller = new AdminController($this->createStub(ResponseFactoryInterface::class), new RequestInput(), $pages);
    }

    protected function tearDown(): void
    {
        $this->database->disconnect();
    }

    /** @return list<array<string, mixed>> */
    private function document(string $text): array
    {
        return [['id' => 'a', 'type' => 'paragraph', 'props' => [], 'content' => [['type' => 'text', 'text' => $text, 'styles' => []]], 'children' => []]];
    }

    public function testStoreSavesVersionsAndKeepsTheFirstSource(): void
    {
        $this->assertNull($this->store->get('page', 1));
        $saved = $this->store->save('page', 1, $this->document('А'), '<p>А</p>', self::ORIGINAL);
        $this->assertSame(1, $saved['version']);
        $this->assertTrue($saved['has_source']);
        $this->assertSame(ComposerStore::hash('<p>А</p>'), $saved['html_hash']);
        $again = $this->store->save('page', 1, $this->document('Б'), '<p>Б</p>', '<p>друго</p>');
        $this->assertSame(2, $again['version']);
        $this->assertSame('Б', $again['document'][0]['content'][0]['text']);
        $this->assertSame(self::ORIGINAL, $this->store->sourceHtml('page', 1), 'the source is kept from the first save only');
        $this->store->delete('page', 1);
        $this->assertNull($this->store->get('page', 1));
    }

    public function testHashIgnoresLineEndings(): void
    {
        $this->assertSame(ComposerStore::hash("<p>a</p>\n<p>b</p>"), ComposerStore::hash("<p>a</p>\r\n<p>b</p>"));
    }

    /** @return iterable<string, array{mixed}> */
    public static function invalidDocuments(): iterable
    {
        yield 'not a list' => [['type' => 'paragraph']];
        yield 'string' => ['<p>a</p>'];
        yield 'block without type' => [[['id' => 'a']]];
        yield 'bad type' => [[['type' => '<script>']]];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('invalidDocuments')]
    public function testStoreRejectsInvalidDocuments(mixed $document): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->store->save('page', 1, $document, '');
    }

    public function testStoreRejectsUnknownTypes(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->store->get('post', 1);
    }

    public function testFirstOpenImportsTheRecord(): void
    {
        $result = $this->controller->document($this->store, $this->records, 'page', 1);
        $this->assertSame('new', $result['state']);
        $this->assertNull($result['document']);
        $this->assertSame(self::ORIGINAL, $result['record']['html']);
        $this->assertSame('/home', $result['record']['url']);
        $this->assertSame(ComposerStore::hash(self::ORIGINAL), $result['record']['html_hash']);
        $this->assertNull($this->controller->document($this->store, $this->records, 'page', 2)['record']['url'], 'drafts have no public address');
    }

    public function testSaveWritesTheRecordThroughPageServiceAndKeepsEverythingElse(): void
    {
        $html = '<h2>Здравейте</h2><p>[gallery id="1"]</p>';
        $result = $this->controller->save($this->store, $this->records, 'page', 1, ['document' => $this->document('Здравейте'), 'html' => $html, 'base_hash' => ComposerStore::hash(self::ORIGINAL)]);
        $this->assertSame('current', $result['state']);
        $this->assertSame('Здравейте', $result['document'][0]['content'][0]['text']);
        $this->assertTrue($result['has_source']);
        $page = $this->db->table('pages')->where('id', 1)->first();
        $this->assertSame($html, $page->content);
        $this->assertSame('Начало', $page->title);
        $this->assertSame('home', $page->slug);
        $this->assertSame('published', $page->status);
        $this->assertSame([['type' => 'paragraph', 'data' => ['text' => 'Стар блок']]], json_decode((string) $page->blocks, true), 'legacy blocks are kept');
    }

    public function testSaveRefusesWhenTheRecordChangedMeanwhileUnlessForced(): void
    {
        $this->db->table('pages')->where('id', 1)->update(['content' => '<p>Някой друг.</p>']);
        try {
            $this->controller->save($this->store, $this->records, 'page', 1, ['document' => $this->document('Мое'), 'html' => '<p>Мое</p>', 'base_hash' => ComposerStore::hash(self::ORIGINAL)]);
            $this->fail('A stale save must be refused.');
        } catch (\InvalidArgumentException $error) {
            $this->assertSame(409, $error->getCode());
        }
        $this->assertSame('<p>Някой друг.</p>', $this->db->table('pages')->where('id', 1)->value('content'));
        $result = $this->controller->save($this->store, $this->records, 'page', 1, ['document' => $this->document('Мое'), 'html' => '<p>Мое</p>', 'base_hash' => 'old', 'force' => true]);
        $this->assertSame('current', $result['state']);
        $this->assertSame('<p>Мое</p>', $this->db->table('pages')->where('id', 1)->value('content'));
    }

    public function testEditsInTheClassicEditorMarkTheDocumentChanged(): void
    {
        $this->controller->save($this->store, $this->records, 'page', 1, ['document' => $this->document('А'), 'html' => '<p>А</p>', 'base_hash' => ComposerStore::hash(self::ORIGINAL)]);
        $this->db->table('pages')->where('id', 1)->update(['content' => '<p>А и още</p>']);
        $result = $this->controller->document($this->store, $this->records, 'page', 1);
        $this->assertSame('changed', $result['state']);
        $this->assertNull($result['document'], 'the editor imports the current HTML instead of the outdated blocks');
        $this->assertTrue($result['has_source']);
    }

    public function testRestoreWritesTheOriginalBackAndForgetsTheDocument(): void
    {
        $this->controller->save($this->store, $this->records, 'page', 1, ['document' => $this->document('А'), 'html' => '<p>А</p>', 'base_hash' => ComposerStore::hash(self::ORIGINAL)]);
        $this->controller->save($this->store, $this->records, 'page', 1, ['document' => $this->document('Б'), 'html' => '<p>Б</p>', 'base_hash' => ComposerStore::hash('<p>А</p>')]);
        $result = $this->controller->restore($this->store, $this->records, 'page', 1);
        $this->assertSame(self::ORIGINAL, $this->db->table('pages')->where('id', 1)->value('content'));
        $this->assertSame('new', $result['state']);
        $this->assertNull($this->store->get('page', 1));
        $this->expectException(\InvalidArgumentException::class);
        $this->controller->restore($this->store, $this->records, 'page', 1);
    }

    public function testSaveValidatesInput(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->controller->save($this->store, $this->records, 'page', 1, ['document' => $this->document('А'), 'html' => ['x'], 'base_hash' => ComposerStore::hash(self::ORIGINAL)]);
    }

    public function testUnknownPagesAreNotFound(): void
    {
        try {
            $this->controller->document($this->store, $this->records, 'page', 99);
            $this->fail('Missing pages must not load.');
        } catch (\InvalidArgumentException $error) {
            $this->assertSame(404, $error->getCode());
        }
    }

    public function testProductsNeedFlexCommerce(): void
    {
        try {
            $this->records->get('product', 1);
            $this->fail('Products must not load without Flex Commerce.');
        } catch (\InvalidArgumentException $error) {
            $this->assertSame(409, $error->getCode());
        }
    }

    public function testUninstallKeepsDataUnlessRequested(): void
    {
        $this->store->save('page', 1, $this->document('А'), '<p>А</p>');
        $this->store->uninstall();
        $this->assertNotNull($this->store->get('page', 1));
        $this->store->saveSettings(['delete_on_uninstall' => true]);
        $this->store->uninstall();
        $this->assertFalse($this->db->getSchemaBuilder()->hasTable('flex_composer_documents'));
        $this->assertFalse($this->db->getSchemaBuilder()->hasTable('flex_composer_settings'));
    }
}
