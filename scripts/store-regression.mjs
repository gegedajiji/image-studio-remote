import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const sourceStorePath = path.join(rootDir, 'src', 'store.js');
const projectNodeModules = path.join(rootDir, 'node_modules');

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function assertRejects(fn, label) {
  try {
    await fn();
  } catch {
    return;
  }
  fail(`${label} should reject`);
}

async function createIsolatedStoreModule() {
  if (!fsSync.existsSync(sourceStorePath)) fail(`missing ${sourceStorePath}`);
  if (!fsSync.existsSync(projectNodeModules)) {
    fail('node_modules is required for runtime store regression checks');
  }
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'image-store-regression-'));
  await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
  await fs.symlink(projectNodeModules, path.join(tempRoot, 'node_modules'), 'dir');
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
  await fs.copyFile(sourceStorePath, path.join(tempRoot, 'src', 'store.js'));
  await fs.writeFile(path.join(tempRoot, 'src', 'config.js'), `
export const config = {
  adminUsername: 'admin_regression',
  adminPassword: 'admin_password_123',
  upstreamBaseUrl: 'https://example.invalid',
  upstreamApiKey: '',
  imageModel: 'gpt-image-2',
  textUpstreamBaseUrl: 'https://example.invalid',
  textUpstreamApiKey: '',
  textModel: 'gpt-4o-mini',
  prices: { '1k': 100, '2k': 200 }
};
`, 'utf8');
  const storeUrl = `${pathToFileURL(path.join(tempRoot, 'src', 'store.js')).href}?t=${Date.now()}`;
  return {
    tempRoot,
    store: await import(storeUrl)
  };
}

function countTransactions(db, type, generationId) {
  return db.transactions.filter((tx) => tx.type === type && tx.generationId === generationId).length;
}

async function main() {
  const { tempRoot, store } = await createIsolatedStoreModule();
  const cleanup = process.argv.includes('--keep-temp')
    ? async () => {}
    : async () => fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});

  try {
    await store.initStore({ recoverPending: false });
    const admin = store.snapshot().users.find((user) => user.role === 'admin');
    assert(admin, 'admin user should be created');

    const user = await store.adminCreateUser({
      account: 'tester001',
      username: 'tester001',
      password: 'secret123',
      balanceCents: 1000,
      operatorId: admin.id
    });
    assert(user.balanceCents === 1000, 'test user should receive initial balance');

    const oldCode = await store.createRedeemCode({
      code: 'KEEP-OLD-001',
      amountCents: 100,
      operatorId: admin.id
    });
    const beforeBatch = store.snapshot().redeemCodes.length;
    const batch = await store.createRedeemCodesBatch({
      amountCents: 200,
      quantity: 3,
      operatorId: admin.id
    });
    const afterBatch = store.snapshot();
    assert(batch.length === 3, 'batch should create requested redeem codes');
    assert(afterBatch.redeemCodes.length === beforeBatch + 3, 'batch should append without replacing old redeem codes');
    assert(afterBatch.redeemCodes.some((item) => item.id === oldCode.id), 'old redeem code should still exist after batch create');
    assert(new Set(afterBatch.redeemCodes.map((item) => item.code)).size === afterBatch.redeemCodes.length, 'redeem codes should be unique');
    await assertRejects(
      () => store.createRedeemCodesBatch({ amountCents: 0, quantity: 2, operatorId: admin.id }),
      'zero amount batch redeem create'
    );
    assert(store.snapshot().redeemCodes.length === afterBatch.redeemCodes.length, 'failed redeem create should not change redeem list');

    const firstCharge = await store.createChargedGeneration({
      userId: user.id,
      amountCents: 300,
      reason: 'regression charge',
      generation: {
        mode: 'generate',
        prompt: 'regression',
        quality: '1k',
        count: 3,
        priceCents: 300,
        startedAt: Date.now()
      }
    });
    assert(store.findUserById(user.id).balanceCents === 700, 'generation precharge should deduct balance');
    await store.refundBalance({
      userId: user.id,
      amountCents: 300,
      generationId: firstCharge.generation.id,
      reason: 'regression full refund'
    });
    const fullSummary = store.generationBillingSummary(firstCharge.generation.id, user.id);
    assert(fullSummary.consumedAmountCents === 300, 'billing summary should include consumed amount');
    assert(fullSummary.refundedAmountCents === 300, 'failed generation should be fully refundable');
    assert(fullSummary.remainingAmountCents === 0, 'full refund should leave zero remaining charge');
    const refundCountBeforeDuplicate = countTransactions(store.snapshot(), 'refund', firstCharge.generation.id);
    await store.refundBalance({
      userId: user.id,
      amountCents: 300,
      generationId: firstCharge.generation.id,
      reason: 'regression duplicate refund'
    });
    assert(countTransactions(store.snapshot(), 'refund', firstCharge.generation.id) === refundCountBeforeDuplicate, 'duplicate refund should not create a second refund transaction');
    assert(store.findUserById(user.id).balanceCents === 1000, 'duplicate refund should not increase balance');

    const secondCharge = await store.createChargedGeneration({
      userId: user.id,
      amountCents: 400,
      reason: 'regression partial charge',
      generation: {
        mode: 'generate',
        prompt: 'regression partial',
        quality: '1k',
        count: 4,
        priceCents: 400,
        startedAt: Date.now()
      }
    });
    await store.refundBalance({
      userId: user.id,
      amountCents: 100,
      generationId: secondCharge.generation.id,
      reason: 'regression partial refund'
    });
    await store.refundBalance({
      userId: user.id,
      amountCents: 400,
      generationId: secondCharge.generation.id,
      reason: 'regression remaining full refund clamp'
    });
    const partialSummary = store.generationBillingSummary(secondCharge.generation.id, user.id);
    assert(partialSummary.refundedAmountCents === 400, 'full retry refund should clamp to remaining charge after partial refund');
    assert(partialSummary.remainingAmountCents === 0, 'partial plus remaining refund should leave zero remaining charge');
    assert(store.findUserById(user.id).balanceCents === 1000, 'partial refund clamp should not over-credit balance');

    const staleStartedAt = Date.now() - 60_000;
    const staleCharge = await store.createChargedGeneration({
      userId: user.id,
      amountCents: 200,
      reason: 'regression stale charge',
      generation: {
        mode: 'generate',
        prompt: 'regression stale',
        quality: '1k',
        count: 2,
        priceCents: 200,
        startedAt: staleStartedAt,
        createdAt: staleStartedAt
      }
    });
    const expired = await store.expireStalePendingGenerations({
      maxAgeMs: 1,
      reason: 'regression stale timeout'
    });
    assert(expired.some((item) => item.id === staleCharge.generation.id && item.amountCents === 200), 'stale pending generation should expire and refund');
    const staleGeneration = store.findGenerationById(staleCharge.generation.id);
    assert(staleGeneration.status === 'failed', 'stale pending generation should be marked failed');
    assert(staleGeneration.metadata?.stalePendingExpired === true, 'stale pending metadata should record expiration');
    assert(store.generationBillingSummary(staleCharge.generation.id, user.id).remainingAmountCents === 0, 'stale pending refund should clear charge');
    assert(store.findUserById(user.id).balanceCents === 1000, 'stale pending refund should restore balance');

    console.log(JSON.stringify({
      ok: true,
      checks: {
        redeemAppendPreservesOldCodes: true,
        redeemAmountValidation: true,
        fullRefundNoDoubleRefund: true,
        partialRefundClamp: true,
        stalePendingRefund: true
      },
      tempRoot
    }, null, 2));
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`store regression failed: ${error.stack || error.message}`);
  process.exit(1);
});
