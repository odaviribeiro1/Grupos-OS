import { test, expect, gotoTimed, shot } from "../helpers/harness";
import { STEP2, APP_CREDS, missingFor } from "../env";

/**
 * Step 4 do wizard (UI), exige build config-B (VITE_SUPABASE_* assadas → app real).
 *  - Login do owner criado no bootstrap.
 *  - Fix #5: o campo OpenAI valida UMA vez e PÁRA (sem loop de re-validação a cada 800ms).
 *    Conta requests a api.openai.com/v1/models após preencher; com o fix, ≤ 2.
 */
test.describe.serial("Wizard Step 4 (UI, config-B)", () => {
  test.beforeAll(() => {
    const miss = missingFor("integration");
    test.skip(miss.length > 0, `Faltam vars: ${miss.join(", ")}`);
  });

  test("login do owner + campo OpenAI valida sem loop (fix #5)", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    let openaiValidations = 0;
    page.on("request", (req) => {
      if (req.url().includes("api.openai.com/v1/models")) openaiValidations++;
    });

    const ms = await gotoTimed(page, "/setup?step=4", testInfo);
    expect(ms, "carga /setup?step=4").toBeLessThan(10_000);

    // Tela de login do Step 4 (sessão ausente).
    await expect(page.getByRole("heading", { name: /Entrar para finalizar/i })).toBeVisible();
    await page.getByPlaceholder("voce@email.com").fill(STEP2.owner_email);
    await page.getByPlaceholder("senha do administrador").fill(STEP2.owner_password);
    await shot(page, "06-step4-login", testInfo);
    await page.getByRole("button", { name: /^Entrar$/ }).click();

    // Form de APIs da aplicação aparece após login.
    await expect(page.getByRole("heading", { name: /APIs da aplicação/i })).toBeVisible({ timeout: 20_000 });
    await shot(page, "06-step4-apis", testInfo);

    // Preenche o campo OpenAI (único que valida via rede em api.openai.com).
    const openaiInput = page.getByPlaceholder("sk-...");
    await openaiInput.fill(APP_CREDS.openai_api_key);

    // Espera a validação concluir (check verde) — prova que NÃO trava em "Validando...".
    await expect(page.locator("svg.lucide-check, .text-\\[\\#10B981\\]").first()).toBeVisible({ timeout: 15_000 });
    // Janela extra para flagrar loop de re-validação.
    await page.waitForTimeout(3000);

    console.log(`[fix#5] validações OpenAI disparadas: ${openaiValidations}`);
    expect(openaiValidations, "campo OpenAI não deve re-validar em loop").toBeLessThanOrEqual(2);
  });
});
