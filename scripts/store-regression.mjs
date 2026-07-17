import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const sourceStorePath = path.join(rootDir, 'src', 'store.js');
const projectNodeModules = path.join(rootDir, 'node_modules');
const oneByOnePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

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

    const billingWithPurchaseUrl = await store.updateBillingPrices({
      prices: { '1k': 123, '2k': 456 },
      purchaseCodeUrl: 'https://example.com/shop/redeem',
      operatorId: admin.id
    });
    assert(billingWithPurchaseUrl.prices['1k'] === 123 && billingWithPurchaseUrl.prices['2k'] === 456, 'billing prices should update');
    assert(billingWithPurchaseUrl.purchaseCodeUrl === 'https://example.com/shop/redeem', 'billing purchase url should update');
    const billingWithoutPurchaseUrl = await store.updateBillingPrices({
      prices: { '1k': 123, '2k': 456 },
      purchaseCodeUrl: '',
      operatorId: admin.id
    });
    assert(billingWithoutPurchaseUrl.purchaseCodeUrl === '', 'billing purchase url should allow explicit clearing');
    await assertRejects(
      () => store.updateBillingPrices({ prices: { '1k': 123, '2k': 456 }, purchaseCodeUrl: 'javascript:alert(1)', operatorId: admin.id }),
      'invalid purchase code url'
    );

    const aiWithKeys = await store.updateAiSettings({
      operatorId: admin.id,
      settings: {
        imageUpstreams: [
          {
            id: 'primary-key-keep',
            name: 'Primary keep key',
            enabled: true,
            upstreamBaseUrl: 'https://image-a.example.com',
            upstreamApiKey: 'image-key-a',
            imageModel: 'gpt-image-2',
            priority: 100,
            weight: 1
          },
          {
            id: 'secondary-key-clear',
            name: 'Secondary clear key',
            enabled: false,
            upstreamBaseUrl: 'https://image-b.example.com',
            upstreamApiKey: 'image-key-b',
            imageModel: 'gpt-image-2',
            priority: 90,
            weight: 1
          }
        ],
        textUpstreamBaseUrl: 'https://text.example.com',
        textUpstreamApiKey: 'text-key-a',
        textModel: 'gpt-4o-mini'
      }
    });
    assert(aiWithKeys.imageUpstreams.length === 2, 'ai settings should keep multiple image upstreams');
    assert(aiWithKeys.imageUpstreams[0].upstreamApiKeyConfigured === true, 'primary image key should be configured');
    assert(aiWithKeys.textUpstreamApiKeyConfigured === true, 'text key should be configured');

    const aiKeepBlankKeys = await store.updateAiSettings({
      operatorId: admin.id,
      settings: {
        imageUpstreams: [
          {
            id: 'primary-key-keep',
            name: 'Primary keep key',
            enabled: true,
            upstreamBaseUrl: 'https://image-a.example.com',
            upstreamApiKey: '',
            imageModel: 'gpt-image-2',
            priority: 100,
            weight: 1
          },
          {
            id: 'secondary-key-clear',
            name: 'Secondary clear key',
            enabled: false,
            upstreamBaseUrl: 'https://image-b.example.com',
            upstreamApiKey: '',
            imageModel: 'gpt-image-2',
            priority: 90,
            weight: 1
          }
        ],
        textUpstreamBaseUrl: 'https://text.example.com',
        textUpstreamApiKey: '',
        textModel: 'gpt-4o-mini'
      }
    });
    assert(aiKeepBlankKeys.imageUpstreams.every((item) => item.upstreamApiKeyConfigured), 'blank image key fields should retain existing keys');
    assert(aiKeepBlankKeys.textUpstreamApiKeyConfigured === true, 'blank text key field should retain existing key');

    await assertRejects(
      () => store.updateAiSettings({
        operatorId: admin.id,
        settings: {
          imageUpstreams: [
            {
              id: 'primary-key-keep',
              name: 'Primary keep key',
              enabled: true,
              upstreamBaseUrl: 'https://image-a.example.com',
              upstreamApiKey: '',
              clearUpstreamApiKey: true,
              imageModel: 'gpt-image-2',
              priority: 100,
              weight: 1
            },
            {
              id: 'secondary-key-clear',
              name: 'Secondary clear key',
              enabled: false,
              upstreamBaseUrl: 'https://image-b.example.com',
              upstreamApiKey: '',
              imageModel: 'gpt-image-2',
              priority: 90,
              weight: 1
            }
          ],
          textUpstreamBaseUrl: 'https://text.example.com',
          textUpstreamApiKey: '',
          textModel: 'gpt-4o-mini'
        }
      }),
      'clearing enabled image upstream key'
    );

    const aiClearedKeys = await store.updateAiSettings({
      operatorId: admin.id,
      settings: {
        imageUpstreams: [
          {
            id: 'primary-key-keep',
            name: 'Primary keep key',
            enabled: true,
            upstreamBaseUrl: 'https://image-a.example.com',
            upstreamApiKey: '',
            imageModel: 'gpt-image-2',
            priority: 100,
            weight: 1
          },
          {
            id: 'secondary-key-clear',
            name: 'Secondary clear key',
            enabled: false,
            upstreamBaseUrl: 'https://image-b.example.com',
            upstreamApiKey: '',
            clearUpstreamApiKey: true,
            imageModel: 'gpt-image-2',
            priority: 90,
            weight: 1
          }
        ],
        textUpstreamBaseUrl: 'https://text.example.com',
        textUpstreamApiKey: '',
        clearTextUpstreamApiKey: true,
        textModel: 'gpt-4o-mini'
      }
    });
    const clearedSecondary = aiClearedKeys.imageUpstreams.find((item) => item.id === 'secondary-key-clear');
    assert(aiClearedKeys.imageUpstreams.find((item) => item.id === 'primary-key-keep')?.upstreamApiKeyConfigured === true, 'primary key should remain configured');
    assert(clearedSecondary?.upstreamApiKeyConfigured === false, 'explicit clear should remove disabled image upstream key');
    assert(aiClearedKeys.textUpstreamApiKeyConfigured === false, 'explicit clear should remove text key');

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

    const partialRecoveryCharge = await store.createChargedGeneration({
      userId: user.id,
      amountCents: 400,
      reason: 'regression partial recovery charge',
      generation: {
        mode: 'generate',
        prompt: 'regression partial recovery',
        quality: '1k',
        count: 4,
        priceCents: 400,
        startedAt: Date.now()
      }
    });
    await store.updateGeneration(partialRecoveryCharge.generation.id, {
      status: 'succeeded',
      metadata: {
        requestedCount: 4,
        returnedCount: 2,
        failedCount: 2,
        partialRefundRequestedCents: 200,
        partialRefundCents: 0,
        partialRefundError: 'simulated refund outage',
        refundPending: true
      }
    });
    const recovered = await store.retryPendingGenerationRefunds({
      limit: 10,
      reason: 'regression partial recovery'
    });
    assert(
      recovered.some((item) => item.id === partialRecoveryCharge.generation.id && item.status === 'refunded' && item.amountCents === 200),
      'partial success refund recovery should only refund the failed-image difference'
    );
    const recoveredPartialSummary = store.generationBillingSummary(partialRecoveryCharge.generation.id, user.id);
    assert(recoveredPartialSummary.refundedAmountCents === 200, 'partial success recovery should not refund successful images');
    assert(recoveredPartialSummary.remainingAmountCents === 200, 'partial success recovery should leave successful-image charge');
    assert(store.findUserById(user.id).balanceCents === 800, 'partial success recovery should only restore failed-image charge');

    await store.refundBalance({
      userId: user.id,
      amountCents: 400,
      generationId: partialRecoveryCharge.generation.id,
      reason: 'regression cleanup remaining charge'
    });
    assert(store.findUserById(user.id).balanceCents === 1000, 'cleanup refund should restore balance for following checks');

    const sourceVisibilityCharge = await store.createChargedGeneration({
      userId: user.id,
      amountCents: 100,
      reason: 'regression source visibility charge',
      generation: {
        mode: 'edit',
        prompt: 'regression source visibility',
        quality: '1k',
        count: 1,
        priceCents: 100,
        outputFormat: 'png',
        startedAt: Date.now()
      }
    });
    await store.updateGeneration(sourceVisibilityCharge.generation.id, {
      status: 'succeeded',
      imageBase64: oneByOnePngBase64,
      sourceImages: [{
        imageBase64: oneByOnePngBase64,
        mimeType: 'image/png',
        outputFormat: 'png'
      }]
    });
    const visibleSourcePost = await store.createCommunityPost({
      userId: user.id,
      generationId: sourceVisibilityCharge.generation.id,
      title: 'source visibility',
      description: 'source visibility regression',
      showSourceImages: true
    });
    assert(visibleSourcePost.showSourceImages === true, 'edit community post should persist source-image visibility opt-in');
    const hiddenSourcePost = await store.updateCommunityPost({
      postId: visibleSourcePost.id,
      userId: user.id,
      title: visibleSourcePost.title,
      description: visibleSourcePost.description,
      tags: visibleSourcePost.tags,
      showSourceImages: false
    });
    assert(hiddenSourcePost.showSourceImages === false, 'community post edit should allow disabling source-image visibility');
    await store.refundBalance({
      userId: user.id,
      amountCents: 100,
      generationId: sourceVisibilityCharge.generation.id,
      reason: 'regression cleanup source visibility charge'
    });
    assert(store.findUserById(user.id).balanceCents === 1000, 'source visibility cleanup refund should restore balance');

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

    const disabledUser = await store.adminCreateUser({
      account: 'pending_cancel_user',
      username: 'pending_cancel_user',
      password: 'secret123',
      balanceCents: 500,
      operatorId: admin.id
    });
    const disabledUserCharge = await store.createChargedGeneration({
      userId: disabledUser.id,
      amountCents: 300,
      reason: 'regression pending cancel charge',
      generation: {
        mode: 'generate',
        prompt: 'regression pending cancel',
        quality: '1k',
        count: 3,
        priceCents: 300,
        startedAt: Date.now()
      }
    });
    assert(store.findUserById(disabledUser.id).balanceCents === 200, 'pending cancel setup should precharge balance');
    const cancelled = await store.failPendingGenerationsForUser({
      userId: disabledUser.id,
      reason: 'regression admin disabled user',
      operatorId: admin.id
    });
    assert(cancelled.some((item) => item.id === disabledUserCharge.generation.id && item.amountCents === 300), 'admin cancellation should refund pending generation');
    const cancelledGeneration = store.findGenerationById(disabledUserCharge.generation.id);
    assert(cancelledGeneration.status === 'failed', 'admin cancellation should mark generation failed');
    assert(cancelledGeneration.metadata?.adminCancelled === true, 'admin cancellation metadata should be recorded');
    assert(store.generationBillingSummary(disabledUserCharge.generation.id, disabledUser.id).remainingAmountCents === 0, 'admin cancellation refund should clear charge');
    assert(store.findUserById(disabledUser.id).balanceCents === 500, 'admin cancellation should restore user balance');
    const refundCountBeforeSecondCancel = countTransactions(store.snapshot(), 'refund', disabledUserCharge.generation.id);
    const cancelledAgain = await store.failPendingGenerationsForUser({
      userId: disabledUser.id,
      reason: 'regression duplicate admin cancellation',
      operatorId: admin.id
    });
    assert(cancelledAgain.length === 0, 'duplicate admin cancellation should not touch terminal generations');
    assert(countTransactions(store.snapshot(), 'refund', disabledUserCharge.generation.id) === refundCountBeforeSecondCancel, 'duplicate admin cancellation should not double refund');

    console.log(JSON.stringify({
      ok: true,
      checks: {
        redeemAppendPreservesOldCodes: true,
        redeemAmountValidation: true,
        billingPurchaseUrl: true,
        aiSettingsClearKeys: true,
        fullRefundNoDoubleRefund: true,
        partialRefundClamp: true,
        partialRefundRecoveryLimit: true,
        communitySourceVisibility: true,
        stalePendingRefund: true,
        adminCancelPendingRefund: true
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
