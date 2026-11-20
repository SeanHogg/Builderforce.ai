/**
 * The `dotnet-minimal` backend part: an ASP.NET Core minimal API with Npgsql (async).
 *
 * It targets net10.0 — the browser runtime's .NET bundle (`DOTNET_BUNDLE.targetFramework`)
 * — and references only packages that bundle carries (Npgsql; any version resolves to the
 * bundled one). `dotnet run` restores and builds by itself, so there is no install step.
 */
import { BACKEND_INGRESS_PATH } from '@builderforce/app-detect/manifest';
import type { KitPart } from '../types';
import { ITEMS_MIGRATION, MEMORY_NOTE } from './backendContract';
import { backendFragment, KIT_API_PORT } from './fragments';

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Npgsql" Version="9.0.3" />
  </ItemGroup>

</Project>
`;

const PROGRAM_CS = `var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var port = Environment.GetEnvironmentVariable("PORT") ?? "${KIT_API_PORT}";
var store = await ItemStore.OpenAsync(Environment.GetEnvironmentVariable("DATABASE_URL"));
const string MemoryNote = ${JSON.stringify(MEMORY_NOTE)};

var health = () => Results.Ok(new { status = "ok", runtime = "dotnet", storage = store.Storage });
app.MapGet("/health", health);
app.MapGet("/api/health", health);

app.MapGet("/api/items", async () =>
{
    var items = await store.ListAsync();
    return store.Storage == "postgres"
        ? Results.Ok(new { items, storage = store.Storage })
        : Results.Ok(new { items, storage = store.Storage, note = MemoryNote });
});

app.MapPost("/api/items", async (NewItem input) =>
{
    var name = input.Name?.Trim() ?? "";
    if (name.Length == 0) return Results.BadRequest(new { error = "name is required" });
    var item = await store.AddAsync(name);
    return Results.Created($"/api/items/{item.Id}", item);
});

app.Run($"http://0.0.0.0:{port}");

record NewItem(string? Name);
`;

const ITEM_STORE_CS = `using Npgsql;

public record Item(int Id, string Name);

/// <summary>Items in Postgres when DATABASE_URL is set, else in memory.</summary>
public sealed class ItemStore
{
    private readonly NpgsqlDataSource? _db;
    private readonly List<Item> _memory = new();

    private ItemStore(NpgsqlDataSource? db) => _db = db;

    public string Storage => _db is null ? "memory" : "postgres";

    public static async Task<ItemStore> OpenAsync(string? databaseUrl)
    {
        if (string.IsNullOrEmpty(databaseUrl)) return new ItemStore(null);
        var db = NpgsqlDataSource.Create(ToConnectionString(databaseUrl));
        // Creates the table when it is missing (the migration is idempotent).
        var migration = await File.ReadAllTextAsync(Path.Combine(Directory.GetCurrentDirectory(), "${ITEMS_MIGRATION}"));
        await using (var command = db.CreateCommand(migration)) await command.ExecuteNonQueryAsync();
        return new ItemStore(db);
    }

    /// <summary>postgres://user:pass@host:port/db → an Npgsql connection string.</summary>
    private static string ToConnectionString(string databaseUrl)
    {
        var uri = new Uri(databaseUrl);
        var credentials = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = uri.AbsolutePath.TrimStart('/') is { Length: > 0 } name ? name : "postgres",
            Username = Uri.UnescapeDataString(credentials[0]),
            Password = credentials.Length > 1 ? Uri.UnescapeDataString(credentials[1]) : null,
        };
        return builder.ConnectionString;
    }

    public async Task<List<Item>> ListAsync()
    {
        if (_db is null) return _memory;
        var items = new List<Item>();
        await using var command = _db.CreateCommand("SELECT id, name FROM items ORDER BY id");
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) items.Add(new Item(reader.GetInt32(0), reader.GetString(1)));
        return items;
    }

    public async Task<Item> AddAsync(string name)
    {
        if (_db is null)
        {
            var created = new Item(_memory.Count + 1, name);
            _memory.Add(created);
            return created;
        }
        await using var command = _db.CreateCommand("INSERT INTO items (name) VALUES ($1) RETURNING id, name");
        command.Parameters.AddWithValue(name);
        await using var reader = await command.ExecuteReaderAsync();
        await reader.ReadAsync();
        return new Item(reader.GetInt32(0), reader.GetString(1));
    }
}
`;

export const DOTNET_MINIMAL: KitPart = {
  id: 'dotnet-minimal',
  kind: 'backend',
  label: '.NET 10 (ASP.NET Core minimal API)',
  aliases: ['dotnet', 'aspnet'],
  serviceId: 'api',
  root: '/api',
  ingress: BACKEND_INGRESS_PATH,
  files: { 'Api.csproj': CSPROJ, 'Program.cs': PROGRAM_CS, 'ItemStore.cs': ITEM_STORE_CS },
  manifest: backendFragment({ runtime: 'dotnet', command: 'dotnet run' }),
};
