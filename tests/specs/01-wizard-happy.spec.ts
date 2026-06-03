import { test, expect, gotoTimed, shot } from "../helpers/harness";
import { STEP2, missingFor } from "../env";

/**
 * Wizard caminho feliz, Steps 1→3 (instância FRESCA, sem VITE_SUPABASE_* no build,
 * para /setup renderizar do zero). Dispara o BOOTSTRAP REAL (migrations + deploy de
 * Edge Functions no Supabase descartável + envs/redeploy na Vercel) — autorizado.
 *
 * Step 4 (login + salvar app creds) é validado em 04-wizard-step4 sob o server
 * full-env, pois o login precisa do client Supabase real (VITE_* assadas no build).
 */
const PLACEHOLDERS: Record<keyof typeof STEP2, string> = {
  supabase_url: "https://xxxx.supabase.co",
  supabase_anon_key: "anon public key",
  supabase_service_role_key: "service role key",
  supabase_pat: "sbp_...",
  vercel_token: "Vercel token",
  owner_email: "voce@email.com",
  owner_password: "mínimo 8 caracteres",
};

test.describe("Wizard /setup — caminho feliz (Steps 1-3 + bootstrap real)", () => {
  test.beforeAll(() => {
    const miss = missingFor("bootstrap");
    test.skip(miss.length > 0, `Faltam vars no .env.test: ${miss.join(", ")}`);
  });

  test("completa Steps 1-3 e o bootstrap conclui", async ({ page }, testInfo) => {
    test.setTimeout(420_000); // bootstrap + waitForHealth pode levar minutos

    const ms = await gotoTimed(page, "/setup", testInfo, "networkidle");
    expect(ms, "carga de /setup").toBeLessThan(10_000);

    // Step 1 — Preparar
    await expect(page.getByRole("heading", { name: /Preparar setup/i })).toBeVisible();
    await shot(page, "01-step1-preparar", testInfo);
    await page.getByRole("button", { name: /Já tenho tudo isso/i }).click();

    // Step 2 — Credenciais core
    await expect(page.getByRole("heading", { name: /Credenciais core/i })).toBeVisible();
    for (const [key, value] of Object.entries(STEP2)) {
      const ph = PLACEHOLDERS[key as keyof typeof STEP2];
      await page.getByPlaceholder(ph, { exact: true }).fill(value);
    }
    await shot(page, "02-step2-preenchido", testInfo);

    // Espera o botão "Configurar" habilitar (todos os campos validados server-side).
    const configurar = page.getByRole("button", { name: /^Configurar$/ });
    await expect(configurar, "todos os campos do Step 2 validados").toBeEnabled({ timeout: 60_000 });
    await configurar.click();

    // Step 3 — Bootstrap em execução
    await expect(page.getByRole("heading", { name: /Bootstrap em execução/i })).toBeVisible();
    await shot(page, "03-step3-bootstrapping", testInfo);

    // Não deve falhar. Aguarda chegar ao Step 4 (login) — sinal de bootstrap concluído
    // + redeploy disparado + health respondendo.
    await expect(page.locator("text=/Falha no bootstrap|BOOTSTRAP_FAILED/i")).toHaveCount(0);
    await page.waitForURL(/step=4/, { timeout: 400_000 });
    await shot(page, "04-step4-apos-bootstrap", testInfo);

    // No Step 4 sem VITE envs, espera-se a tela de login manual (ou APIs da aplicação).
    await expect(
      page.getByRole("heading", { name: /Entrar para finalizar|APIs da aplicação/i })
    ).toBeVisible();
  });
});
