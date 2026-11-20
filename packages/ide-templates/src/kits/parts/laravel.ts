/**
 * The `laravel` backend part — a Laravel-STYLE PHP API on Slim 4, not Laravel itself.
 *
 * The browser runtime runs PHP as php-wasm behind `php -S` (request-driven), installs
 * pure-PHP Composer packages, and speaks Postgres through its own PDO pgsql over virtual
 * TCP. A full Laravel skeleton is not yet supported there (its install and boot are far
 * past what php-wasm carries today), so this part keeps Laravel's layout (`public/` front
 * controller, `routes/api.php`, `app/` under the `App\` namespace) on Slim. The kit id
 * stays `laravel` because that is what people ask for (`react-laravel`).
 *
 * `php -S` runs every request in a fresh PHP execution, so the no-database fallback is a
 * JSON file in the temp directory rather than memory: memory would empty per request.
 */
import type { KitPart } from '../types';
import { ITEMS_MIGRATION, MEMORY_NOTE } from './backendContract';
import { backendFragment, KIT_API_PORT } from './fragments';

const COMPOSER_JSON = JSON.stringify({
  name: 'app/api',
  type: 'project',
  require: { php: '>=8.1', 'slim/slim': '^4.14', 'slim/psr7': '^1.7' },
  autoload: { 'psr-4': { 'App\\': 'app/' } },
}, null, 2);

const INDEX_PHP = `<?php
declare(strict_types=1);

use Slim\\Factory\\AppFactory;

require __DIR__ . '/../vendor/autoload.php';

$app = AppFactory::create();
$app->addBodyParsingMiddleware();
$app->addErrorMiddleware(true, true, true);

(require __DIR__ . '/../routes/api.php')($app);

$app->run();
`;

const ROUTES_PHP = `<?php
declare(strict_types=1);

use App\\ItemStore;
use Psr\\Http\\Message\\ResponseInterface as Response;
use Psr\\Http\\Message\\ServerRequestInterface as Request;
use Slim\\App;

function json_response(Response $response, array $data, int $status = 200): Response
{
    $response->getBody()->write(json_encode($data));
    return $response->withHeader('Content-Type', 'application/json')->withStatus($status);
}

return function (App $app): void {
    $store = ItemStore::fromEnvironment();

    $health = fn (Request $request, Response $response) =>
        json_response($response, ['status' => 'ok', 'runtime' => 'php', 'storage' => $store->storage()]);
    $app->get('/health', $health);
    $app->get('/api/health', $health);

    $app->get('/api/items', function (Request $request, Response $response) use ($store) {
        $body = ['items' => $store->all(), 'storage' => $store->storage()];
        if ($store->storage() !== 'postgres') {
            $body['note'] = ${JSON.stringify(MEMORY_NOTE)};
        }
        return json_response($response, $body);
    });

    $app->post('/api/items', function (Request $request, Response $response) use ($store) {
        $input = (array) $request->getParsedBody();
        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '') {
            return json_response($response, ['error' => 'name is required'], 400);
        }
        return json_response($response, $store->add($name), 201);
    });
};
`;

const ITEM_STORE_PHP = `<?php
declare(strict_types=1);

namespace App;

use PDO;

/** Items in Postgres when DATABASE_URL is set, else in a JSON file (php -S runs each request afresh). */
final class ItemStore
{
    private function __construct(private ?PDO $pdo, private string $file)
    {
    }

    public static function fromEnvironment(): self
    {
        $file = sys_get_temp_dir() . '/items.json';
        $url = getenv('DATABASE_URL');
        if (!$url) {
            return new self(null, $file);
        }
        $parts = parse_url($url);
        $dsn = sprintf(
            'pgsql:host=%s;port=%d;dbname=%s',
            $parts['host'] ?? 'localhost',
            $parts['port'] ?? 5432,
            ltrim($parts['path'] ?? '/postgres', '/') ?: 'postgres'
        );
        $pdo = new PDO($dsn, urldecode($parts['user'] ?? 'postgres'), urldecode($parts['pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        // Creates the table when it is missing (the migration is idempotent).
        $pdo->exec((string) file_get_contents(__DIR__ . '/../${ITEMS_MIGRATION}'));
        return new self($pdo, $file);
    }

    public function storage(): string
    {
        return $this->pdo ? 'postgres' : 'file';
    }

    /** @return list<array{id: int, name: string}> */
    public function all(): array
    {
        if ($this->pdo) {
            return $this->pdo->query('SELECT id, name FROM items ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
        }
        return is_file($this->file) ? json_decode((string) file_get_contents($this->file), true) : [];
    }

    /** @return array{id: int, name: string} */
    public function add(string $name): array
    {
        if ($this->pdo) {
            $statement = $this->pdo->prepare('INSERT INTO items (name) VALUES (:name) RETURNING id, name');
            $statement->execute(['name' => $name]);
            return $statement->fetch(PDO::FETCH_ASSOC);
        }
        $items = $this->all();
        $item = ['id' => count($items) + 1, 'name' => $name];
        $items[] = $item;
        file_put_contents($this->file, json_encode($items));
        return $item;
    }
}
`;

export const LARAVEL: KitPart = {
  id: 'laravel',
  kind: 'backend',
  label: 'PHP (Slim, Laravel-style — full Laravel is not yet supported in the browser runtime)',
  aliases: ['php', 'slim'],
  serviceId: 'api',
  root: '/api',
  ingress: '/api',
  files: {
    'composer.json': COMPOSER_JSON,
    'public/index.php': INDEX_PHP,
    'routes/api.php': ROUTES_PHP,
    'app/ItemStore.php': ITEM_STORE_PHP,
  },
  manifest: backendFragment({ runtime: 'php', command: `php -S 0.0.0.0:${KIT_API_PORT} -t public`, install: 'composer install' }),
};
