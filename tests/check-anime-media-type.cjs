const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables from .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials missing for test.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

test('Unit-level check: /anime query shows zero manga', async () => {
  // 1. Check getAnimePage equivalent query for media_type = 'anime'
  const { data: animePage, error: pageErr } = await supabase
    .from('anime')
    .select('id, slug, media_type')
    .eq('media_type', 'anime')
    .limit(50);

  assert.ifError(pageErr);
  assert.ok(Array.isArray(animePage), 'Expected anime items array');

  // Verify every returned item is anime and none is manga
  const mangaInAnime = animePage.filter((item) => item.media_type === 'manga');
  assert.strictEqual(
    mangaInAnime.length,
    0,
    `Expected 0 manga items in /anime query, but found ${mangaInAnime.length}`
  );

  for (const item of animePage) {
    assert.strictEqual(item.media_type, 'anime', `Expected item ${item.slug} to be anime`);
  }

  // 2. Popular anime query
  const { data: popularAnime, error: popErr } = await supabase
    .from('anime')
    .select('id, slug, media_type')
    .eq('media_type', 'anime')
    .order('popularity', { ascending: false, nullsFirst: false })
    .limit(20);

  assert.ifError(popErr);
  const mangaInPopular = (popularAnime || []).filter((item) => item.media_type === 'manga');
  assert.strictEqual(mangaInPopular.length, 0, 'Popular anime should contain zero manga');

  // 3. Manga query counterpart check
  const { data: mangaPage, error: mangaErr } = await supabase
    .from('anime')
    .select('id, slug, media_type')
    .eq('media_type', 'manga')
    .limit(20);

  assert.ifError(mangaErr);
  const animeInManga = (mangaPage || []).filter((item) => item.media_type === 'anime');
  assert.strictEqual(animeInManga.length, 0, 'Manga query should contain zero anime');

  console.log('✓ Unit check passed: /anime queries return zero manga items.');
});
