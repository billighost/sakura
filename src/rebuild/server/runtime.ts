import { getRebuildPool, inTransaction } from "../data/db";
import { CachedCatalogProvider, DeezerCatalogProvider, SpotifyCatalogProvider } from "./providers";
import { PostgresRecordingRepository, type ReadonlySql } from "./repository";
import { RecordingResolver } from "./resolver";
import { RecordingAudioGateway, SourceAudioTransport } from "./gateway";
import type { CatalogProvider } from "./contracts";
import { DeezerCatalogService } from "./catalog";
import { RecordingIngestor, type SqlTransaction } from "./ingestion";
import { WorkerAudioDiscovery } from "./sources";
import { AudioResolutionJobs } from "./jobs";
import { ProductionRecordingResolver } from "./production-resolver";
import { PlaybackTargets } from "./targets";
import { MusicCollectionImporter } from "./import";
import { createHash } from "node:crypto";
import { AudioPromotions, CloudinaryAudioPublisher } from "./promotion";

interface RebuildServices { resolver: ProductionRecordingResolver; gateway: RecordingAudioGateway; catalog: DeezerCatalogService; ingestor: RecordingIngestor; jobs: AudioResolutionJobs; importer:MusicCollectionImporter;promotions:AudioPromotions;publisher?:CloudinaryAudioPublisher }
const globalRuntime = globalThis as unknown as { sakuraV2Services?: RebuildServices;sakuraV2ServicesKey?:string;sakuraV2Generation?:symbol };
// Re-evaluation after an HMR dependency update must retire old class instances.
const runtimeGeneration=Symbol("Sakura v2 runtime generation");

/** Configuration is server-only. Nothing here imports legacy player/catalog/download logic. */
export function getRebuildServices(): RebuildServices {
  const configurationKey=createHash("sha256").update(JSON.stringify(["ink-cdn-audio-v5",process.env.TELEGRAM_WORKER_URL,process.env.WORKER_SECRET,process.env.TELEGRAM_BOT_USERNAME,
    process.env.TELEGRAM_FALLBACK_BOTS,process.env.SAKURA_REBUILD_AUDIO_ORIGINS,process.env.SPOTIFY_CLIENT_ID,process.env.SPOTIFY_CLIENT_SECRET,process.env.YOUTUBE_API_KEY,process.env.CLOUDINARY_CLOUD_NAME,process.env.CLOUDINARY_API_KEY,process.env.CLOUDINARY_API_SECRET])).digest("hex");
  if (globalRuntime.sakuraV2Services&&globalRuntime.sakuraV2ServicesKey===configurationKey&&globalRuntime.sakuraV2Generation===runtimeGeneration) return globalRuntime.sakuraV2Services;
  const pool = getRebuildPool();
  const query: ReadonlySql = async <Row>(statement: string,parameters: readonly unknown[]) => (await pool.query(statement,[...parameters])).rows as Row[];
  const transaction: SqlTransaction = async <Value>(operation: (query: ReadonlySql) => Promise<Value>) => inTransaction(async (client) => operation(async <Row>(statement: string,parameters: readonly unknown[]) => (await client.query(statement,[...parameters])).rows as Row[]));
  const repository = new PostgresRecordingRepository(query);
  const providers: CatalogProvider[] = [new CachedCatalogProvider(new DeezerCatalogProvider())];
  let spotify:SpotifyCatalogProvider|undefined;
  if (process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim()) {
    spotify=new SpotifyCatalogProvider(process.env.SPOTIFY_CLIENT_ID.trim(), process.env.SPOTIFY_CLIENT_SECRET.trim());
    providers.push(new CachedCatalogProvider(spotify));
  }
  const workerUrl = process.env.TELEGRAM_WORKER_URL?.trim();
  const workerSecret = process.env.WORKER_SECRET?.trim();
  const transport = new SourceAudioTransport({
    allowedCdnOrigins: (process.env.SAKURA_REBUILD_AUDIO_ORIGINS ?? "https://res.cloudinary.com").split(",").map((value) => value.trim()).filter(Boolean),
    worker: workerUrl && workerSecret ? { url: workerUrl, secret: workerSecret, chatScope: process.env.TELEGRAM_BOT_USERNAME?.trim() || "musicshuntersbot" } : undefined,
  });
  const existing = new RecordingResolver(repository,providers,(asset) => transport.directPlaybackUrl(asset));
  const ingestor = new RecordingIngestor(transaction,providers);
  const discovery = new WorkerAudioDiscovery(workerUrl && workerSecret ? { url: workerUrl,secret: workerSecret,primaryBot: process.env.TELEGRAM_BOT_USERNAME?.trim() || "musicshuntersbot",fallbackBots: (process.env.TELEGRAM_FALLBACK_BOTS ?? "").split(",").map((bot) => bot.trim()).filter(Boolean) } : null, fetch, providers);
  const targets=new PlaybackTargets(repository,transport);
  const publisher=process.env.CLOUDINARY_CLOUD_NAME&&process.env.CLOUDINARY_API_KEY&&process.env.CLOUDINARY_API_SECRET?new CloudinaryAudioPublisher({cloudName:process.env.CLOUDINARY_CLOUD_NAME,apiKey:process.env.CLOUDINARY_API_KEY,apiSecret:process.env.CLOUDINARY_API_SECRET}):undefined;
  const promotions=new AudioPromotions(transport,ingestor,publisher);
  const jobs = new AudioResolutionJobs(query,repository,ingestor,discovery,existing,targets,promotions);
  const catalog=new DeezerCatalogService(fetch,spotify);
  const importer=new MusicCollectionImporter(catalog,ingestor,transaction,{spotifyClientId:process.env.SPOTIFY_CLIENT_ID,spotifyClientSecret:process.env.SPOTIFY_CLIENT_SECRET,youtubeApiKey:process.env.YOUTUBE_API_KEY});
  const services = { resolver: new ProductionRecordingResolver(repository,ingestor,existing,jobs,targets),gateway: new RecordingAudioGateway(repository,transport),catalog,ingestor,jobs,importer,promotions,publisher };
  globalRuntime.sakuraV2Services = services;
  globalRuntime.sakuraV2ServicesKey=configurationKey;
  globalRuntime.sakuraV2Generation=runtimeGeneration;
  return services;
}
