import type { Db } from '../../infrastructure/database/connection';
import { PostgresWebSearchStore } from '../../infrastructure/webSearch/postgresWebSearchStore';
import { CrawlerHttpClient } from '../../infrastructure/webSearch/crawlerHttp';
import { WebCrawlerService } from './crawlerService';
import { InternetSearchService } from './searchService';

export function buildInternetSearch(db: Db) {
  const store = new PostgresWebSearchStore(db);
  return { search: new InternetSearchService(store), crawler: new WebCrawlerService(store, new CrawlerHttpClient()) };
}

