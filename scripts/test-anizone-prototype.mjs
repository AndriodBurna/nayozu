import { searchAniZone, getAniZoneEpisodeStream, probeAniZoneHLS } from '../lib/providers/anizonePrototype.ts';

async function testPrototype() {
  console.log('========================================================');
  console.log('Testing AniZone Isolated Prototype (TypeScript)');
  console.log('========================================================\n');

  const titles = [
    { query: 'Death Note', knownSlug: 'gxl93akq' },
    { query: 'Attack on Titan', knownSlug: 'rwft8nfc' },
    { query: 'Frieren', knownSlug: 'mdkytdqp' },
  ];

  for (const { query, knownSlug } of titles) {
    console.log(`>>> 1. Searching for: "${query}"`);
    let slug = knownSlug;
    try {
      const results = await searchAniZone(query);
      console.log(`Found ${results.length} search results.`);
      if (results.length > 0) {
        slug = results[0].slug;
        console.log(`Matched title: "${results[0].main_title}" (slug: ${slug})`);
      }
    } catch (err) {
      console.warn(`Search network warning: ${err.message}. Using known slug: ${slug}`);
    }

    console.log(`>>> 2. Resolving Episode 1 stream for slug "${slug}"...`);
    try {
      const stream = await getAniZoneEpisodeStream(slug, 1);
      console.log(`Resolved stream URL: ${stream.hlsUrl}`);
      console.log(`Subtitles count: ${stream.subtitles.length}`);
      if (stream.subtitles.length > 0) {
        console.log(`First subtitle: ${stream.subtitles[0].title} (${stream.subtitles[0].file})`);
      }

      console.log(`>>> 3. Probing HLS stream & encryption...`);
      const probe = await probeAniZoneHLS(stream);
      console.log(`Master M3U8 HTTP status: ${probe.masterStatus}`);
      console.log(`Variant streams count: ${probe.variants.length}`);
      console.log(`Encryption: ${probe.encryptionKeyHeader || 'None'}`);
      console.log(`Requires Referer: ${probe.requiresReferer}`);
      if (probe.sampleVideoChunkBytes) {
        console.log(`Sample TS Chunk: HTTP ${probe.sampleVideoChunkStatus} (${probe.sampleVideoChunkBytes} bytes)`);
      }
      console.log('--------------------------------------------------------\n');
    } catch (err) {
      console.error(`Error resolving stream for "${query}":`, err.message, '\n');
    }
  }
}

testPrototype();
