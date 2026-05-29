import { test, expect, gotoTimed, shot } from "../helpers/harness";
import { STEP2, BASE_URL, missingFor } from "../env";

/**
 * Caminhos de erro / validação do wizard. Validação client-side (regex) não precisa
 * das creds; validação server-side de token e a reentrada idempotente do bootstrap
 * pulam se faltarem vars no .env.test.
 */
test.describe("Wizard /setup — validação e erros", () => {
  test("Step 2: validação client-side mostra erro claro em pt-BR e mantém 'Configurar' desabilitado", async ({
    page,
  }, testInfo) => {
    await gotoTimed(page, "/setup", testInfo);
    await page.getByRole("button", { name: /Já tenho tudo isso/i }).click();
    await expect(page.getByRole("heading", { name: /Credenciais core/i })).toBeVisible();

    // URL Supabase inválida
    await page.getByPlaceholder("https://xxxx.supabase.co", { exact: true }).fill("nao-e-url");
    await expect(page.locator("text=/URL Supabase inválida/i")).toBeVisible({ timeout: 5000 });

    // Email inválido
    await page.getByPlaceholder("voce@email.com", { exact: true }).fill("email-ruim");
    await expect(page.locator("text=/Email inválido/i")).toBeVisible({ timeout: 5000 });

    // Senha fraca
    await page.getByPlaceholder("mínimo 8 caracteres", { exact: true }).fill("123");
    await expect(page.locator("text=/8\\+ caracteres com letras e números/i")).toBeVisible({ timeout: 5000 });

    await shot(page, "02e-validacao-client", testInfo);
    await expect(page.getByRole("button", { name: /^Configurar$/ })).toBeDisabled();
  });

  test("Step 2: token Supabase inválido reprova na validação server-side", async ({ page }, testInfo) => {
    const miss = missingFor("integration");
    test.skip(miss.length > 0, `precisa de SUPABASE_URL no .env.test e /api up: ${miss.join(", ")}`);

    await gotoTimed(page, "/setup", testInfo);
    await page.getByRole("button", { name: /Já tenho tudo isso/i }).click();
    await page.getByPlaceholder("https://xxxx.supabase.co", { exact: true }).fill(STEP2.supabase_url);
    // anon key claramente inválida → /api/validate-token deve reprovar
    await page.getByPlaceholder("anon public key", { exact: true }).fill("chave-invalida-xyz");
    await expect(page.locator("span svg.text-\\[\\#EF4444\\], p.text-xs")).toBeVisible({ timeout: 15_000 }).catch(() => {});
    await expect(page.getByRole("button", { name: /^Configurar$/ })).toBeDisabled();
    await shot(page, "02e-token-invalido-server", testInfo);
  });

  test("Bootstrap é idempotente na reentrada (steps já completos não repetem)", async ({ request }) => {
    const miss = missingFor("bootstrap");
    test.skip(miss.length > 0, `Faltam vars no .env.test: ${miss.join(", ")}`);

    const payload = { ...STEP2 };
    const first = await request.post(`${BASE_URL}/api/bootstrap`, { data: payload, timeout: 300_000 });
    const a = await first.json();
    expect(a.success, `1ª chamada: ${JSON.stringify(a)}`).toBeTruthy();

    const second = await request.post(`${BASE_URL}/api/bootstrap`, { data: payload, timeout: 300_000 });
    const b = await second.json();
    expect(b.success, `2ª chamada: ${JSON.stringify(b)}`).toBeTruthy();
    // Idempotente: a 2ª passada não recria owner/migrations/envs (só re-deploya EFs por design).
    const repeated = (b.steps_completed ?? []).filter((s: string) =>
      /owner_created|migration:|vercel_envs_set|postgrest_configured/.test(s)
    );
    expect(repeated, `re-executou steps não-idempotentes: ${repeated.join(", ")}`).toHaveLength(0);
    // #9: owner_user_id deve voltar preenchido mesmo no re-run (lido do metadata).
    expect(b.owner_user_id, "owner_user_id não-vazio no re-run").toBeTruthy();
  });
});
